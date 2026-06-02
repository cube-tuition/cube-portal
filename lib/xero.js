/**
 * lib/xero.js — Xero API helper (server-side only)
 * ─────────────────────────────────────────────────
 * Handles token storage/refresh and wraps the Xero Accounting API.
 */
import { createClient } from '@supabase/supabase-js'

const XERO_TOKEN_URL   = 'https://identity.xero.com/connect/token'
const XERO_API_BASE    = 'https://api.xero.com/api.xro/2.0'

function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

/** Load stored tokens from DB. Returns null if not connected. */
export async function getStoredTokens() {
  const { data } = await adminSupabase()
    .from('xero_tokens')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  return data || null
}

/** Persist tokens to the single-row xero_tokens table. */
async function saveTokens({ access_token, refresh_token, tenant_id, expires_in }) {
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString()
  await adminSupabase()
    .from('xero_tokens')
    .upsert({ id: 1, access_token, refresh_token, tenant_id, expires_at, updated_at: new Date().toISOString() })
}

/** Exchange an auth code for tokens (called from /api/xero/callback). */
export async function exchangeCode({ code, tenant_id }) {
  const params = new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: process.env.XERO_REDIRECT_URI,
  })
  const res = await fetch(XERO_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      Authorization:   'Basic ' + Buffer.from(
        `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
      ).toString('base64'),
    },
    body: params.toString(),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
  const json = await res.json()
  await saveTokens({ ...json, tenant_id })
  return json
}

/** Get a valid access token, refreshing if expired. */
export async function getValidToken() {
  const stored = await getStoredTokens()
  if (!stored) throw new Error('Xero not connected. Please connect via Settings.')

  const expiresAt = new Date(stored.expires_at)
  // Refresh if expiring within 2 minutes
  if (expiresAt.getTime() - Date.now() < 120_000) {
    const params = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: stored.refresh_token,
    })
    const res = await fetch(XERO_TOKEN_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        Authorization:   'Basic ' + Buffer.from(
          `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
        ).toString('base64'),
      },
      body: params.toString(),
    })
    if (!res.ok) throw new Error(`Xero token expired — please click Reconnect in the portal. (${await res.text()})`)
    const json = await res.json()
    await saveTokens({ ...json, tenant_id: stored.tenant_id })
    return { access_token: json.access_token, tenant_id: stored.tenant_id }
  }

  return { access_token: stored.access_token, tenant_id: stored.tenant_id }
}

/** Make an authenticated request to the Xero API, with retry on 429. */
async function xeroFetch(path, { method = 'GET', body } = {}, retries = 3) {
  const { access_token, tenant_id } = await getValidToken()
  const res = await fetch(`${XERO_API_BASE}${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${access_token}`,
      'Xero-Tenant-Id': tenant_id,
      'Content-Type': 'application/json',
      Accept:         'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 429 && retries > 0) {
    // Respect Retry-After header if present, else back off 65 seconds
    const retryAfter = parseInt(res.headers.get('Retry-After') || '65', 10)
    const waitMs = (retryAfter + 1) * 1000
    console.warn(`Xero 429 on ${method} ${path} — waiting ${waitMs}ms before retry (${retries} retries left)`)
    await new Promise(r => setTimeout(r, waitMs))
    return xeroFetch(path, { method, body }, retries - 1)
  }

  const text = await res.text()
  if (!res.ok) throw new Error(`Xero API ${method} ${path} failed (${res.status}): ${text}`)
  if (!text) return {}
  try { return JSON.parse(text) } catch {
    throw new Error(`Xero API ${method} ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }
}

/**
 * Fetch ALL contacts from Xero (paginated).
 * Returns a map of { emailLower -> ContactID } and { nameLower -> ContactID }.
 */
export async function fetchAllContacts() {
  const byEmail = {}
  const byName  = {}
  let page = 1
  while (true) {
    const res = await xeroFetch(`/Contacts?pageSize=100&page=${page}&includeArchived=false`)
    const contacts = res.Contacts || []
    for (const c of contacts) {
      if (c.EmailAddress) byEmail[c.EmailAddress.toLowerCase()] = c.ContactID
      byName[c.Name.toLowerCase()] = c.ContactID
    }
    if (contacts.length < 100) break
    page++
  }
  return { byEmail, byName }
}

/**
 * Find or create a Xero Contact using a pre-fetched contact map.
 * Pass the maps from fetchAllContacts(); only calls Xero if contact is new.
 * Returns the Xero ContactID.
 */
export async function findOrCreateContactCached({ name, email, phone }, { byEmail, byName }) {
  // Match in-memory first (no API call)
  if (email && byEmail[email.toLowerCase()]) return byEmail[email.toLowerCase()]
  if (byName[name.toLowerCase()]) return byName[name.toLowerCase()]

  // Create new contact in Xero
  const created = await xeroFetch('/Contacts', {
    method: 'POST',
    body: {
      Contacts: [{
        Name:         name,
        EmailAddress: email || undefined,
        Phones:       phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: phone }] : [],
      }],
    },
  })
  const contactId = created.Contacts[0].ContactID
  // Update local cache so subsequent invoices in the same run don't re-create
  if (email) byEmail[email.toLowerCase()] = contactId
  byName[name.toLowerCase()] = contactId
  return contactId
}

/**
 * Find or create a Xero Contact for a student/family.
 * Matches on email first; falls back to name.
 * Returns the Xero ContactID.
 */
export async function findOrCreateContact({ name, email, phone }) {
  // Search by email
  if (email) {
    const q = new URLSearchParams({ where: `EmailAddress=="${email}"` })
    const search = await xeroFetch(`/Contacts?${q}`)
    if (search.Contacts?.length > 0) return search.Contacts[0].ContactID
  }

  // Search by name
  const q2 = new URLSearchParams({ searchTerm: name })
  const nameSearch = await xeroFetch(`/Contacts?${q2}`)
  if (nameSearch.Contacts?.length > 0) {
    const exact = nameSearch.Contacts.find(
      c => c.Name.toLowerCase() === name.toLowerCase()
    )
    if (exact) return exact.ContactID
  }

  // Create new contact
  const created = await xeroFetch('/Contacts', {
    method: 'POST',
    body: {
      Contacts: [{
        Name:         name,
        EmailAddress: email || undefined,
        Phones:       phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: phone }] : [],
      }],
    },
  })
  return created.Contacts[0].ContactID
}

/**
 * Create a single draft Xero invoice.
 * Returns the Xero InvoiceID.
 */
export async function createXeroInvoice({ contactId, invoiceRef, lineItems, dueDate }) {
  const result = await createXeroInvoicesBatch([{ contactId, invoiceRef, lineItems, dueDate }])
  return result[0].InvoiceID
}

/**
 * Batch-create up to 50 draft Xero invoices in a single API call.
 * Returns the array of Xero Invoice objects (in the same order as input).
 */
export async function createXeroInvoicesBatch(invoices) {
  const result = await xeroFetch('/Invoices', {
    method: 'POST',
    body: {
      Invoices: invoices.map(({ contactId, invoiceRef, lineItems, dueDate }) => ({
        Type:            'ACCREC',
        Status:          'DRAFT',
        Contact:         { ContactID: contactId },
        Reference:       invoiceRef,
        DueDate:         dueDate,
        LineItems:       lineItems,
        LineAmountTypes: 'Inclusive',
      })),
    },
  })
  return result.Invoices
}

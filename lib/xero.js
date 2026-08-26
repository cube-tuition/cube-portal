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

/**
 * Scopes on the stored access token.
 *
 * Xero grants scopes at consent time, so a connection made before a scope was
 * added keeps working for everything else and fails only on the new endpoint.
 * Reading them lets the portal say "reconnect to enable payments" up front
 * instead of after a staff member marks an invoice paid and it silently
 * doesn't reach Xero.
 */
export async function getTokenScopes() {
  const stored = await getStoredTokens()
  if (!stored?.access_token) return []
  try {
    const payload = JSON.parse(
      Buffer.from(stored.access_token.split('.')[1], 'base64url').toString()
    )
    return [].concat(payload.scope || [])
  } catch { return [] }
}

/**
 * Payments need accounting.payments; invoices push fine without it.
 * The granular scope, not the broad accounting.transactions it replaces —
 * asking for both makes Xero reject the whole consent with invalid_scope.
 */
export const PAYMENTS_SCOPE = 'accounting.payments'

/** Make an authenticated request to the Xero API. */
async function xeroFetch(path, { method = 'GET', body } = {}) {
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

  if (res.status === 429) {
    throw new Error(`Xero rate limit hit — wait 60 seconds then try again`)
  }
  // Reads and invoice writes work on the older scope set, so a 401 on Payments
  // is almost never a dead session — it is the connection missing
  // accounting.payments. Say which one it is; "Unauthorized" alone sends
  // people hunting for the wrong problem.
  if (res.status === 401 && path.startsWith('/Payments')) {
    throw new Error('Xero connection is missing the payments permission — click Reconnect in the portal to grant it, then try again')
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
 * Batch upsert contacts in a single Xero API call.
 * contacts: [{ name, email, phone }]
 * Returns an array of ContactIDs in the same order.
 */
export async function upsertXeroContacts(contacts) {
  const result = await xeroFetch('/Contacts', {
    method: 'POST',
    body: {
      Contacts: contacts.map(({ name, email, phone }) => ({
        Name:         name,
        EmailAddress: email || undefined,
        Phones:       phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: phone }] : [],
      })),
    },
  })
  return result.Contacts.map(c => c.ContactID)
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
 * Fetch invoices by Xero InvoiceID, in bulk.
 *
 * Returns a Map of InvoiceID -> invoice. An id that Xero no longer knows about
 * is simply absent from the map rather than throwing, because a deleted invoice
 * is an ordinary state here: staff delete them in Xero and the portal keeps the
 * stale link until someone resets it.
 */
export async function fetchXeroInvoicesByIds(ids) {
  const out = new Map()
  const unique = [...new Set(ids.filter(Boolean))]
  // IDs go in the query string, so keep each request comfortably short.
  const CHUNK = 40
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK)
    const q = new URLSearchParams({ IDs: slice.join(',') })
    const res = await xeroFetch(`/Invoices?${q}`)
    for (const inv of res.Invoices || []) out.set(inv.InvoiceID, inv)
  }
  return out
}

/**
 * Apply a payment to a Xero invoice — this is how an invoice becomes PAID.
 * Xero has no status flag to set: PAID is derived from the payments applied.
 *
 * The invoice must be AUTHORISED; Xero rejects payments against a DRAFT.
 * Returns the Xero PaymentID.
 */
export async function createXeroPayment({ invoiceId, accountCode, amount, date, reference }) {
  const res = await xeroFetch('/Payments', {
    method: 'POST',
    body: {
      Payments: [{
        Invoice: { InvoiceID: invoiceId },
        Account: { Code: accountCode },
        Date:    date,
        Amount:  Number(amount),
        ...(reference ? { Reference: reference } : {}),
      }],
    },
  })
  const payment = res.Payments?.[0]
  if (!payment?.PaymentID) {
    const detail = payment?.ValidationErrors?.map(e => e.Message).join(', ')
    throw new Error(detail || 'Xero returned no PaymentID')
  }
  return payment.PaymentID
}

/**
 * Reverse a payment we created, so un-marking an invoice as paid in the portal
 * puts the money back as owing in Xero. Xero deletes payments by POSTing a
 * DELETED status to them — there is no DELETE verb for this resource.
 */
export async function deleteXeroPayment(paymentId) {
  await xeroFetch(`/Payments/${paymentId}`, {
    method: 'POST',
    body: { Payments: [{ PaymentID: paymentId, Status: 'DELETED' }] },
  })
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
      Invoices: invoices.map(({ contactId, invoiceNumber, reference, lineItems, dueDate }) => ({
        Type:            'ACCREC',
        Status:          'DRAFT',
        Contact:         { ContactID: contactId },
        InvoiceNumber:   invoiceNumber,
        ...(reference ? { Reference: reference } : {}),
        DueDate:         dueDate,
        LineItems:       lineItems,
        LineAmountTypes: 'Inclusive',
      })),
    },
  })
  return result.Invoices
}

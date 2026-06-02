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
    if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
    const json = await res.json()
    await saveTokens({ ...json, tenant_id: stored.tenant_id })
    return { access_token: json.access_token, tenant_id: stored.tenant_id }
  }

  return { access_token: stored.access_token, tenant_id: stored.tenant_id }
}

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
  const text = await res.text()
  if (!res.ok) throw new Error(`Xero API ${method} ${path} failed (${res.status}): ${text}`)
  return text ? JSON.parse(text) : {}
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
 * Create a draft Xero invoice.
 * Returns the Xero InvoiceID.
 */
export async function createXeroInvoice({ contactId, invoiceRef, lineItems, dueDate }) {
  const result = await xeroFetch('/Invoices', {
    method: 'POST',
    body: {
      Invoices: [{
        Type:        'ACCREC',          // accounts receivable
        Status:      'DRAFT',
        Contact:     { ContactID: contactId },
        Reference:   invoiceRef,
        DueDate:     dueDate,           // ISO date string
        LineItems:   lineItems,         // [{ Description, Quantity, UnitAmount, AccountCode }]
        LineAmountTypes: 'NOTAX',
      }],
    },
  })
  return result.Invoices[0].InvoiceID
}

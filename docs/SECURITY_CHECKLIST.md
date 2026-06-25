# CUBE Portal — Security Checklist

A living tracker. `- [x]` = done & verified, `- [ ]` = outstanding.
Last reviewed: 2026-06-24.

Legend: 🔴 critical · 🟠 high · 🟡 medium · 🟢 low/hardening

---

## 1. Database authorization (RLS)

- [x] 🔴 RLS enabled on every table holding PII / grades / financial data
      (guardians, exam_marks, exam_question_marks, cash_log, fixed_costs,
      trial_submissions, portal_settings, qbank_*, …). *Applied 2026-06-24.*
- [x] 🔴 Blanket `authenticated_full_access USING(true)` policy removed/narrowed to
      `is_staff()` everywhere — students can no longer read/write all tables.
- [x] 🔴 `xero_tokens` is service-role-only (no client policy).
- [x] 🟡 `is_staff()` includes director (future-proof; broadening only).
- [ ] 🟡 Tighten writes to least privilege: tutors should not be able to write
      `invoices` / `pay_runs` / `students` via the API (currently any staff can,
      via the staff blanket). Replace staff blanket with granular admin-write +
      staff-read where the app allows.
- [ ] 🟡 Confirm `students` / `guardians` student-self policies expose only the
      logged-in student's own rows (no cross-student reads).
- [ ] 🟢 Re-run Supabase **security advisors** and clear all "RLS disabled in
      public" / "security definer" findings after each schema change.
- [ ] 🟢 Add a CI/test check that fails if any new `public` table ships with RLS
      disabled or a `USING(true)` policy.

## 2. API route authentication & authorization

- [x] 🟠 Server-side auth helper (`requireApiRole`) that verifies the JWT and
      checks `app_metadata.role` (not user-editable).
- [x] 🟠 Financial / email / mutation routes call `requireApiRole`
      (send-invoice, approve-invoice, generate-draft-invoices, xero/push,
      update-invoice-status, cancel-lesson, …).
- [x] 🟠 `send-discount-program-emails` now requires admin/director (was an open
      email relay). *Fixed 2026-06-24.*
- [x] 🟡 `xero/items` and `xero/accounts` now require admin/director
      (were leaking the Xero catalog / chart of accounts).
- [x] 🟠 Remove `/api/exec-ddl` (and the `exec_ddl` RPC) — arbitrary SQL over
      HTTP; even admin-gated it's a remote DB console / huge blast radius.
      *Done 2026-06-24: dropped `exec_ddl()` function; route returns 410; client
      helper neutered; New Table / Rename / Delete-column UI removed. Schema
      changes now via dashboard/migrations. (Row editing — incl. tutors —
      unaffected.) `git rm app/api/exec-ddl/route.js` locally to delete the stub.*
- [ ] 🟡 Auth the booklet-PDF route (`/api/booklet/[id]/pdf/[idx]`) — currently
      UUID-only. Refactor to return a short-lived signed URL via `authedFetch`
      instead of a public 302.
- [ ] 🟡 Xero OAuth CSRF: replace the static `state=cube-xero-connect` with a
      per-session random nonce and validate it in `/api/xero/callback`.
- [ ] 🟢 `CRON_SECRET` checks (`sync-*` routes) use constant-time compare
      (`crypto.timingSafeEqual`).
- [ ] 🟢 Routes return generic error messages to clients; log details server-side
      only (avoid leaking stack traces / DB errors).
- [ ] 🟢 Every API route validates/normalises its request body (type + bounds)
      before use.

## 3. Secrets & environment

- [x] 🟢 No secret carries a `NEXT_PUBLIC_` prefix (only URL + anon key + site
      URL are public — by design).
- [x] 🟢 No secrets hardcoded in source; none referenced in client components.
- [x] 🟢 `.env*` is gitignored, untracked, and absent from git history;
      `.env.local` is `chmod 600`.
- [x] 🟢 `next.config` does not re-expose server env to the client.
- [x] 🟢 Service-role key confined to server API routes only.
- [ ] 🟡 Scope third-party keys to least privilege (Airtable PAT → booklets base
      only; Resend key → send-only).
- [ ] 🟢 Documented secret-rotation procedure (on staff offboarding / suspected
      leak) for Supabase service role, Resend, Xero, Airtable, CRON_SECRET.

## 4. Input validation & abuse protection

- [ ] 🟡 Rate-limit the public `trial-submission` endpoint (and add a captcha /
      honeypot) — currently open CORS `*` with no throttling (spam / DB flood).
- [ ] 🟢 Rate-limit auth-sensitive and email-sending routes (per-IP / per-user).
- [ ] 🟢 Cap request body sizes on routes that accept HTML/JSON payloads.

## 5. Transport & browser headers

- [ ] 🟡 Security headers set (HSTS, `X-Content-Type-Options: nosniff`,
      `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`) via `next.config`
      or middleware.
- [ ] 🟢 Content-Security-Policy defined (at least a baseline; tighten over time).
- [ ] 🟢 Tighten `trial-submission` CORS from `*` to the cubetuition.com.au origin.

## 6. Accounts, sessions & roles

- [ ] 🟠 MFA enabled for all admin (and director) accounts in Supabase Auth.
- [ ] 🟡 Strong password policy / leaked-password protection enabled in Supabase
      Auth settings.
- [ ] 🟡 `app_metadata.role` is only ever set server-side (service role /
      dashboard); confirm no client path can set or change a user's role.
- [ ] 🟢 Periodic review of who has admin/director; remove stale accounts.
- [ ] 🟢 Session expiry / refresh settings reviewed (not excessively long-lived).

## 7. Dependencies & supply chain

- [ ] 🟡 `npm audit` clean (or known-accepted); enable Dependabot/automated
      dependency updates.
- [ ] 🟢 Lockfile committed and builds are reproducible.

## 8. Operations, logging & recovery

- [ ] 🟡 Supabase automated backups enabled + a tested restore procedure.
- [ ] 🟢 Audit trail for sensitive admin actions (invoice send, payroll, data
      deletes) — at minimum rely on `updated_at`/`*_by` columns; consider a log.
- [ ] 🟢 Alerting on auth anomalies / error spikes.
- [ ] 🟢 A documented incident-response contact + steps (who to call, how to
      rotate keys, how to revoke sessions).

---

### Done so far (2026-06-24)
RLS hardening applied to production; blanket policy narrowed; `xero_tokens`
locked down; `send-discount-program-emails`, `xero/items`, `xero/accounts`
authenticated; **`exec-ddl` removed (function dropped, route/UI retired)**;
secrets/env posture verified clean.

### Suggested next (in priority order)
1. Security headers + CORS tightening (§5) · 2. Rate-limit `trial-submission`
(§4) · 3. Admin MFA (§6) · 4. Booklet-PDF signed URLs + Xero OAuth `state` (§2).

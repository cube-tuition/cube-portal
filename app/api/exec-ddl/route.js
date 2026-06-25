import { NextResponse } from 'next/server'

/*
 * /api/exec-ddl — REMOVED.
 *
 * This endpoint used to run arbitrary SQL via the exec_ddl() RPC, which was a
 * remote database console / critical security risk. It has been retired: the
 * exec_ddl() function is dropped, and schema changes now go through migrations
 * or the Supabase dashboard.
 *
 * (This stub remains only because the deploy environment can't delete files;
 * `git rm app/api/exec-ddl/route.js` to remove it entirely.)
 */
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint has been removed. Make schema changes via a migration or the Supabase dashboard.' },
    { status: 410 },
  )
}

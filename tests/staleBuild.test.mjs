/*
 * lib/staleBuild — telling "a new version went live" apart from a real crash.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStaleBuildError } from '../lib/staleBuild.js'

test('chunk-load failures after a deploy are recognised (they reload, not crash)', () => {
  for (const e of [
    { name: 'ChunkLoadError', message: 'Failed to load chunk /_next/static/chunks/01z.ly_0eiu~_.js from module 64893' },
    { message: 'Loading chunk 123 failed.' },
    { message: 'Loading CSS chunk app-layout failed' },
    { message: 'Failed to fetch dynamically imported module: https://portal.cubetuition.com.au/_next/x.js' },
    { message: 'Importing a module script failed.' },
  ]) assert.equal(isStaleBuildError(e), true, e.message)
})

test('real bugs are not mistaken for a deploy (they are reported)', () => {
  for (const e of [
    { message: 'fmtPct is not defined' },
    { message: "null is not an object (evaluating 'e.person.localeCompare')" },
    { message: 'workbook realtime channel CHANNEL_ERROR' },
    null,
  ]) assert.equal(isStaleBuildError(e), false, String(e?.message))
})

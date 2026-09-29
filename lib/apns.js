import http2 from 'node:http2'
import { createSign } from 'node:crypto'

/*
 * Apple Push Notification service, server-side — pushes to the native CUBE
 * Tuition iPhone app (the Capacitor shell). Token-based auth with the .p8 key
 * from the Apple Developer account:
 *   APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY (the .p8 file's contents),
 *   APNS_BUNDLE_ID (default au.com.cubetuition.portal)
 *
 * TestFlight and App Store builds talk to the production gateway; a build run
 * straight from Xcode onto a phone talks to the sandbox. A token is only valid
 * on one, so each send tries production and retries on sandbox when Apple
 * says the token is wrong there. Fails soft; returns tokens Apple has retired
 * so the caller can delete them.
 */
export const apnsConfigured = () => !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_KEY)

let _jwt = null, _jwtAt = 0
function providerToken() {
  // Apple accepts a token for an hour; refresh well inside that.
  if (_jwt && Date.now() - _jwtAt < 40 * 60 * 1000) return _jwt
  const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
  const head = b64u({ alg: 'ES256', kid: process.env.APNS_KEY_ID })
  const claims = b64u({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })
  const key = process.env.APNS_KEY.replace(/\\n/g, '\n')
  const sig = createSign('SHA256').update(`${head}.${claims}`).sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  _jwt = `${head}.${claims}.${sig}`; _jwtAt = Date.now()
  return _jwt
}

function sendOne(host, token, payload, topic) {
  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`)
    client.on('error', () => resolve({ status: 0 }))
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${token}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': topic, 'apns-push-type': 'alert', 'apns-priority': '10',
    })
    let body = ''
    req.on('response', (h) => { req.on('data', (d) => { body += d }); req.on('end', () => { client.close(); let reason = ''; try { reason = JSON.parse(body || '{}').reason || '' } catch { /* empty */ } resolve({ status: h[':status'], reason }) }) })
    req.on('error', () => { client.close(); resolve({ status: 0 }) })
    req.end(JSON.stringify(payload))
  })
}

/** Send one alert to many device tokens. Returns { sent, dead: [tokens to delete] }. */
export async function sendApns(tokens, { title, body, url, tag }) {
  if (!apnsConfigured() || !tokens?.length) return { sent: 0, dead: [] }
  const topic = process.env.APNS_BUNDLE_ID || 'au.com.cubetuition.portal'
  const payload = { aps: { alert: { title, body }, sound: 'default', 'thread-id': tag || 'cube' }, url }
  let sent = 0; const dead = []
  await Promise.all(tokens.map(async (t) => {
    let r = await sendOne('api.push.apple.com', t, payload, topic)
    if (r.status === 400 && r.reason === 'BadDeviceToken') r = await sendOne('api.sandbox.push.apple.com', t, payload, topic)
    if (r.status === 200) sent += 1
    else if (r.status === 410 || r.reason === 'Unregistered' || r.reason === 'BadDeviceToken') dead.push(t)
  }))
  return { sent, dead }
}

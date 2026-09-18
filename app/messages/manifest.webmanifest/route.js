// The manifest for the standalone Messages app. Served from a route rather
// than /public so its start_url and name stay next to the page they describe.
export const dynamic = 'force-static'

export function GET() {
  return Response.json({
    name: 'CUBE Messages',
    short_name: 'Messages',
    description: 'Texts and calls with families on the CUBE office number.',
    id: '/messages',
    start_url: '/messages',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F8FAFF',
    theme_color: '#325099',
    icons: [
      { src: '/icons/icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any' },
      { src: '/icons/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any maskable' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json' } })
}

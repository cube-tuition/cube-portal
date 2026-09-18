/*
 * /messages — the standalone "CUBE Messages" app. Its own manifest (name,
 * icon, start URL) so "Add to Home Screen" installs this screen as an app of
 * its own rather than the whole portal; Apple needs the extra meta and a PNG
 * icon to do the same on iPhone.
 */
export const metadata = {
  title: 'CUBE Messages',
  description: 'Texts and calls with families on the CUBE office number.',
  manifest: '/messages/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'CUBE Messages' },
  icons: { apple: '/icons/icon-192.png' },
}

export const viewport = {
  themeColor: '#325099',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function MessagesLayout({ children }) {
  return children
}

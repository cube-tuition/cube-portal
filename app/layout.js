import { Outfit, Inter } from "next/font/google";
import "./globals.css";
import NoNumberScroll from "../components/NoNumberScroll";
import NativePushRegistrar from "../components/NativePushRegistrar";
import NativeLinkGuard from "../components/NativeLinkGuard";
import NativePullRefresh from "../components/NativePullRefresh";
import { APP_FLAG_SCRIPT } from "../lib/nativeApp";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata = {
  title: "CUBE Tuition · Student Portal",
  description: "Track your results, sign in to drop-in help, and access your booklets.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${inter.variable} h-full antialiased`}
      // data-app is set by the inline script below inside the iPhone app, so
      // the server's <html> and the client's legitimately differ there.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APP_FLAG_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <NoNumberScroll />
        <NativePushRegistrar />
        <NativeLinkGuard />
        <NativePullRefresh />
        {children}
      </body>
    </html>
  );
}

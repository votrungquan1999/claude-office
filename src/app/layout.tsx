import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Office",
  applicationName: "Claude Office",
  description:
    "A pixel-art office that shows every running Claude Code session.",
  // The office is private to its owner; nothing here belongs in search results.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
  // iOS ignores the manifest's name and display; these make "Add to Home Screen" open full screen.
  appleWebApp: {
    capable: true,
    title: "Office",
    // An opaque bar: under a translucent one iOS lays the page out one status bar short and leaves a strip at the bottom.
    statusBarStyle: "black",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#1e1e2e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // iOS Safari ignores this; the canvas's `touch-none` is what stops page zoom there.
  userScalable: false,
  interactiveWidget: "resizes-content",
};

/**
 * The root layout shared by every page.
 * @param props - The page to wrap.
 * @returns The document shell.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

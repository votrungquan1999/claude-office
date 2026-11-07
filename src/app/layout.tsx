import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "Claude Office" };

export const viewport: Viewport = {
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

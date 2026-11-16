import type { MetadataRoute } from "next";

/**
 * The web app manifest Android and desktop Chrome read when the office is added to the home screen.
 * @returns The manifest, served at `/manifest.webmanifest`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Claude Office",
    short_name: "Office",
    description:
      "A pixel-art office that shows every running Claude Code session.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1e1e2e",
    theme_color: "#1e1e2e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // Android crops this one to its own shape, so the art sits inside the centre safe zone.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

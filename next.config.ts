import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Mongo driver is server-only; keep it out of any client bundle.
  serverExternalPackages: ["mongodb"],

  // Lets a test run build into its own directory; sharing `.next` with an open dev server makes both hang.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // `next dev` otherwise writes AGENTS.md and CLAUDE.md into the repo when it detects an AI agent.
  agentRules: false,

  // The office must never be framed by another site (clickjacking); both headers cover old and new browsers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
        ],
      },
    ];
  },

  experimental: {
    // TypeScript 7 drops the JS compiler API Next reaches for by default; without this the dev server hangs.
    useTypeScriptCli: true,
  },
};

export default nextConfig;

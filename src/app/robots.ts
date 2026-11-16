import type { MetadataRoute } from "next";

/**
 * The office is private to its owner, so no crawler gets any page.
 * @returns The rules, served at `/robots.txt`.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

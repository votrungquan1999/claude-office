import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";

/**
 * Hands every auth request to better-auth; the instance is built per request so the module loads without env.
 * @param request - The incoming request.
 * @returns The auth response.
 */
export async function GET(request: NextRequest) {
  return toNextJsHandler(await getAuth()).GET(request);
}

/**
 * Hands every auth POST to better-auth.
 * @param request - The incoming request.
 * @returns The auth response.
 */
export async function POST(request: NextRequest) {
  return toNextJsHandler(await getAuth()).POST(request);
}

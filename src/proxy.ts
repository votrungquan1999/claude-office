import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Sends a request with no session cookie to sign-in (pages) or answers 401 (APIs). It only sees that a
 * cookie exists; `requireOwner()` in each page and API is the real check.
 * @param request - The incoming request.
 * @returns A redirect, a 401, or the request unchanged.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  // A literal pattern: a variable here silently widens the matcher.
  matcher: [
    "/((?!sign-in|api/auth|_next/|favicon\\.ico|assets/|fonts/|robots\\.txt|api/connect$|api/connect/collect$).*)",
  ],
};

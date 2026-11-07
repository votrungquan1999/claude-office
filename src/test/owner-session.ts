import { makeSignature } from "better-auth/crypto";
import { getAuth } from "@/lib/auth";

/** better-auth's cookie name over http; https would prefix `__Secure-`. */
export const SESSION_COOKIE_NAME = "better-auth.session_token";

/**
 * Creates a user and a session through better-auth's own path and returns the signed session cookie.
 * @param email - The user's email.
 * @param emailVerified - Whether Google verified the email.
 * @returns The request headers carrying the cookie, or `null` when better-auth refused the account.
 */
export async function sessionHeadersFor(
  email: string,
  emailVerified = true,
): Promise<Headers | null> {
  const { internalAdapter } = await (await getAuth()).$context;
  const user = await internalAdapter.createUser({
    email,
    emailVerified,
    name: email,
  });
  if (!user) return null;
  const session = await internalAdapter.createSession(user.id);
  if (!session) return null;
  return new Headers({ cookie: await signedCookie(session.token) });
}

/**
 * The `Cookie` header value for a session token, signed the way better-auth signs it.
 * @param token - The session token.
 * @returns The header value.
 */
export async function signedCookie(token: string): Promise<string> {
  return `${SESSION_COOKIE_NAME}=${await signedCookieValue(token)}`;
}

/**
 * Just the signed, URL-encoded value of the session cookie (what a browser cookie jar stores).
 * @param token - The session token.
 * @returns The cookie value.
 */
export async function signedCookieValue(token: string): Promise<string> {
  const signature = await makeSignature(
    token,
    process.env.BETTER_AUTH_SECRET ?? "",
  );
  return encodeURIComponent(`${token}.${signature}`);
}

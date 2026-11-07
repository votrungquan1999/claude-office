/** Where a visitor lands after signing in when the URL names nowhere to go back to. */
const APP_ROOT = "/";

/**
 * The path to return to after a successful sign-in, or the app root when the URL's `next` value
 * is absent or is not a same-origin path.
 *
 * `next` is attacker-controllable and is reflected into a navigation, so this is a security
 * boundary rather than input tidying.
 * @param raw - the `next` parameter's value, or `null` when absent
 */
export function safeReturnPath(raw: string | null): string {
  if (raw === null) return APP_ROOT;
  // The WHATWG URL parser strips ASCII tab/newline/CR from anywhere in a URL before parsing it,
  // so "/\t/evil.com" resolves off-origin at navigation time even though it looks same-origin
  // here — strip the same characters first, so what gets validated is what actually navigates.
  const normalized = raw.replace(/[\t\n\r]/g, "");
  // One leading slash, and the next character must not be another slash or a backslash — that
  // pair is what turns a "path" into an authority, and so into a different origin.
  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.startsWith("/\\")
  ) {
    return APP_ROOT;
  }
  return normalized;
}

import { getAuth } from "@/lib/auth";
import { readAuthEnv } from "@/lib/env";

/** The signed-in owner, as far as pages and APIs need to know. */
export interface Owner {
  email: string;
}

/**
 * The owner behind a request, or null when it is signed out or belongs to anyone else.
 * @param headers - The request headers, holding the session cookie.
 * @returns The owner, or null.
 */
export async function requireOwner(headers: Headers): Promise<Owner | null> {
  const session = await (await getAuth()).api.getSession({ headers });
  const email = session?.user.email;
  // The email is checked again here so a session that predates a changed ALLOWED_EMAIL gets nothing.
  if (
    !email ||
    email.toLowerCase() !== readAuthEnv().ALLOWED_EMAIL.toLowerCase()
  ) {
    return null;
  }
  return { email };
}

"use client";

import { authClient } from "@/lib/auth-client";

/**
 * The Google sign-in button; a refused account comes back to the sign-in page with an error code.
 * @param props - Where to go after a successful sign-in.
 * @returns The button.
 */
export function SignInButton({ returnPath }: { returnPath: string }) {
  return (
    <button
      type="button"
      className="rounded border px-4 py-2"
      onClick={() =>
        authClient.signIn.social({
          provider: "google",
          callbackURL: returnPath,
          errorCallbackURL: "/sign-in",
        })
      }
    >
      Sign in with Google
    </button>
  );
}

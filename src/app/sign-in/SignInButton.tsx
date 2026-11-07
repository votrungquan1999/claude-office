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
      className="pixel-panel px-16 py-8 hover:bg-btn-hover"
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

"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side better-auth client, used for the Google sign-in redirect. */
export const authClient = createAuthClient();

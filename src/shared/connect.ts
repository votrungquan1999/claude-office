import { z } from "zod";

/** Letters and digits that cannot be mistaken for one another when read off a screen. */
export const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const USER_CODE_LENGTH = 8;

/** How long a code stays usable, and how many unexpired ones may exist at once. */
export const CONNECT_CODE_TTL_MS = 10 * 60_000;
export const MAX_OPEN_CONNECT_CODES = 5;

export const createConnectRequestSchema = z.object({
  hostname: z.string().trim().min(1).max(100),
});

export const createConnectResponseSchema = z.object({
  userCode: z.string(),
  pollSecret: z.string(),
  connectUrl: z.string(),
});

export const approveConnectRequestSchema = z.object({
  userCode: z.string().min(1).max(32),
});

/** What a Mac needs to write to the database; only ever sent once, to the approved Mac. */
export const collectConnectResponseSchema = z.object({
  mongodbUri: z.string().min(1),
  mongodbDb: z.string().min(1),
});

export type CreateConnectResponse = z.infer<typeof createConnectResponseSchema>;

/**
 * The code as shown to people, split in two halves.
 * @param userCode - The stored 8-character code.
 * @returns For example `ABCD-2345`.
 */
export function formatUserCode(userCode: string): string {
  return `${userCode.slice(0, 4)}-${userCode.slice(4)}`;
}

/**
 * Reads a typed or linked code back to its stored form.
 * @param raw - Text such as `abcd-2345`.
 * @returns The upper-case code without dashes or spaces.
 */
export function normalizeUserCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

import { createHash, randomBytes, randomInt } from "node:crypto";
import { USER_CODE_ALPHABET, USER_CODE_LENGTH } from "@/shared/connect";

/** A pending connect request as stored; the poll secret is kept only as a hash. */
export interface ConnectCodeDoc {
  userCode: string;
  secretHash: string;
  hostname: string;
  approved: boolean;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Hash of a poll secret, so the database never holds the secret itself.
 * @param secret - The secret the Mac polls with.
 * @returns Hex SHA-256.
 */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** @returns A random code from the unambiguous alphabet. */
export function newUserCode(): string {
  return Array.from(
    { length: USER_CODE_LENGTH },
    () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)],
  ).join("");
}

/** @returns A random secret with 256 bits of entropy. */
export function newPollSecret(): string {
  return randomBytes(32).toString("base64url");
}

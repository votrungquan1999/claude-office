/**
 * The readable text of anything that was thrown.
 * @param error - The caught value.
 * @returns Its message when it is an Error, else its string form.
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Waits for a time.
 * @param ms - How long.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

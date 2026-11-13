/**
 * Whether an employee newly needs the owner.
 * @param previous - The keys that needed the owner at the last look; null before the first look.
 * @param next - The keys that need the owner now.
 * @returns True when a key is in `next` that was not in `previous`; false for the first look, which only records what is there.
 */
export function hasArrival(
  previous: ReadonlySet<string> | null,
  next: ReadonlySet<string>,
): boolean {
  if (previous === null) return false;
  for (const key of next) if (!previous.has(key)) return true;
  return false;
}

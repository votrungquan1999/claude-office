import type { SessionDto } from "./session";

/**
 * The last folder of a path.
 * @param cwd - A folder path.
 * @returns Its last segment, or the path itself when it has none.
 */
export function folderName(cwd: string): string {
  return cwd.split("/").filter(Boolean).at(-1) ?? cwd;
}

/**
 * The name shown for an employee.
 * @param session - The employee's session.
 * @returns The owner's name, else the desk name, else the folder's name.
 */
export function employeeName(
  session: Pick<SessionDto, "ownerName" | "deskName" | "cwd">,
): string {
  return session.ownerName ?? session.deskName ?? folderName(session.cwd);
}

/**
 * What saving a typed name asks the server to store, so the drawer and the tab editor agree.
 * @param draft - The text the owner saved.
 * @param company - The company's shown name and its folder's own name.
 * @returns The name to send (null puts the folder name back), or null when saving changes nothing.
 */
export function renameToSend(
  draft: string,
  company: { name: string; folderName: string },
): { displayName: string | null } | null {
  const typed = draft.trim();
  // A blank or the folder's own name means "no name".
  const next = typed === "" || typed === company.folderName ? null : typed;
  const stored = company.name === company.folderName ? null : company.name;
  return next === stored ? null : { displayName: next };
}

/**
 * What saving a typed employee name asks the server to store.
 * @param draft - The text the owner saved.
 * @param names - The owner's name now (absent when none) and the automatic name.
 * @returns The name to send (empty brings the automatic name back), or null when saving changes nothing.
 */
export function employeeNameToSend(
  draft: string,
  names: { ownerName?: string; automaticName: string },
): string | null {
  const typed = draft.replace(/\s+/g, " ").trim();
  // A blank or the automatic name itself means "no owner's name".
  const next = typed === names.automaticName ? "" : typed;
  return next === (names.ownerName ?? "") ? null : next;
}

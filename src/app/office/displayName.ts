import type { SetDisplayNameRequest } from "@/shared/folders";

/**
 * Sends one company name to the server.
 * @param request - The Mac, the folder and the new name; null puts the folder name back.
 * @returns True when the server stored it, false on any refusal or network failure.
 */
export async function postDisplayName(
  request: SetDisplayNameRequest,
): Promise<boolean> {
  try {
    const response = await fetch("/api/office/folders/display-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    return response.ok;
  } catch {
    return false;
  }
}

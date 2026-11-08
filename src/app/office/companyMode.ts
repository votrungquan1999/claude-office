import type { SetCompanyModeRequest } from "@/shared/folders";

/**
 * Sends one company-mode switch to the server.
 * @param request - The Mac, the folder and the new value.
 * @returns True when the server stored it, false on any refusal or network failure.
 */
export async function postCompanyMode(
  request: SetCompanyModeRequest,
): Promise<boolean> {
  try {
    const response = await fetch("/api/office/folders/company-mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    return response.ok;
  } catch {
    return false;
  }
}

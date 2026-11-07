import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/require-owner";

/**
 * The office; only the owner gets past the gate.
 * @returns The office page.
 */
export default async function HomePage() {
  if (!(await requireOwner(await headers()))) redirect("/sign-in?next=%2F");
  return <main data-testid="office">Office</main>;
}

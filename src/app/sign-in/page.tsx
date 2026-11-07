import { safeReturnPath } from "@/lib/sign-in-return-path";
import { SignInButton } from "./SignInButton";

const REFUSED_CODES = new Set([
  "unable_to_create_user",
  "unable_to_create_session",
]);

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The sign-in page; it renders without the database so a paused cluster never blocks it.
 * @param props - The request's query string.
 * @returns The sign-in screen.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const returnPath = safeReturnPath(
    typeof query.next === "string" ? query.next : null,
  );
  const refused =
    typeof query.error === "string" && REFUSED_CODES.has(query.error);

  return (
    <main className="mx-auto grid min-h-svh max-w-sm content-center gap-4 p-4">
      <h1 className="text-lg font-bold">Claude Office</h1>
      {refused && <p role="alert">This Google account is not allowed</p>}
      <SignInButton returnPath={returnPath} />
    </main>
  );
}

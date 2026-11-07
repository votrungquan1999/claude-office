import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/mongo";
import type { ConnectCodeDoc } from "@/lib/connect-codes";
import { requireOwner } from "@/lib/require-owner";
import { formatUserCode, normalizeUserCode } from "@/shared/connect";
import { ConnectButton } from "./ConnectButton";

interface ConnectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Where the owner approves a Mac that asked to connect; it shows the Mac's name and the code the
 * terminal printed so a link crafted by someone else can be told apart.
 * @param props - The request's query string, carrying the code.
 * @returns The approval screen.
 */
export default async function ConnectPage({ searchParams }: ConnectPageProps) {
  const query = await searchParams;
  const raw = typeof query.code === "string" ? query.code : "";
  if (!(await requireOwner(await headers()))) {
    redirect(`/sign-in?next=${encodeURIComponent(`/connect?code=${raw}`)}`);
  }
  const userCode = normalizeUserCode(raw);
  const request = await (await getDb())
    .collection<ConnectCodeDoc>("connectCodes")
    .findOne({ userCode, expiresAt: { $gt: new Date() } });

  return (
    <main className="mx-auto grid h-dvh max-w-sm content-center gap-16 p-16">
      <h1 className="text-xl">Connect a Mac</h1>
      {request ? (
        <>
          <p>
            Connect{" "}
            <strong data-testid="connect-hostname">{request.hostname}</strong>?
          </p>
          <p>
            Code{" "}
            <strong data-testid="connect-code">
              {formatUserCode(userCode)}
            </strong>
          </p>
          <p className="text-sm">Check that this code matches your terminal.</p>
          <ConnectButton userCode={userCode} />
        </>
      ) : (
        <p role="alert" className="pixel-panel p-8 text-sm">
          This code is unknown or has expired. Run the setup again to get a new
          one.
        </p>
      )}
    </main>
  );
}

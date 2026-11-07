"use client";

import { useState } from "react";

type Phase = "idle" | "sending" | "approved" | "failed";

/**
 * Approves the Mac with one click.
 * @param props - The code to approve.
 * @returns The button and its outcome message.
 */
export function ConnectButton({ userCode }: { userCode: string }) {
  const [phase, setPhase] = useState<Phase>("idle");

  async function approve() {
    setPhase("sending");
    const response = await fetch("/api/connect/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode }),
    }).catch(() => null);
    setPhase(response?.ok ? "approved" : "failed");
  }

  if (phase === "approved") {
    return <p role="status">Connected. You can go back to your terminal.</p>;
  }
  return (
    <>
      <button
        type="button"
        className="pixel-panel px-16 py-8 hover:bg-btn-hover"
        disabled={phase === "sending"}
        onClick={approve}
      >
        Connect this Mac
      </button>
      {phase === "failed" && (
        <p role="alert" className="pixel-panel p-8 text-sm">
          That did not work. The code may have expired; run the setup again.
        </p>
      )}
    </>
  );
}

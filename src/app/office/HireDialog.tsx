import { useState } from "react";
import { MacBlock } from "@/office/offline";
import { CommandFailReason } from "@/shared/commands";
import type { FolderDto } from "@/shared/folders";
import { postHire } from "./hire";
import { type OrderPhase, useOrderStatus } from "./useOrderStatus";

export interface HireMac {
  machineId: string;
  machineName: string;
  /** Why the Mac cannot take orders; absent when it can. */
  block?: MacBlock;
}

export interface HireDialogProps {
  macs: HireMac[];
  folders: FolderDto[];
  /** The Mac of the viewed company, picked first when it can take orders. */
  initialMachineId: string | null;
  /** The viewed company's folder, picked first when the Mac knows it. */
  initialFolder: string | null;
  onClose: () => void;
}

const BLOCK_NOTES: Record<MacBlock, string> = {
  [MacBlock.Offline]: "offline",
  [MacBlock.Outdated]: "update this Mac's agent",
};

const FAILURE_TEXT: Record<CommandFailReason, string> = {
  [CommandFailReason.FolderMissing]: "The folder is missing on the Mac.",
  [CommandFailReason.ClaudeNotFound]: "Claude Code was not found on the Mac.",
  [CommandFailReason.LaunchFailed]: "The Mac could not open the window.",
  [CommandFailReason.Interrupted]:
    "The Mac's agent restarted before the window opened.",
  [CommandFailReason.ConversationNotFound]: "The conversation was not found.",
  [CommandFailReason.OpenElsewhere]: "That conversation is open elsewhere.",
  [CommandFailReason.InvalidOrder]: "The Mac refused the order as not valid.",
};

/** The line under the form for each phase of the order. */
function outcomeText(phase: OrderPhase): string | null {
  if (phase.phase === "pending") return "Sending to the Mac…";
  if (phase.phase === "notSent") {
    return "Not sent: the Mac did not pick it up in time. Nothing will run later.";
  }
  if (phase.phase === "lostContact") {
    return "The office lost contact. The Mac may still run the hire; check the Mac before trying again.";
  }
  if (phase.phase === "checkMac") {
    return "The Mac took the order but the window has not opened. Check the Mac.";
  }
  if (phase.phase === "failed") return FAILURE_TEXT[phase.reason];
  return null;
}

/**
 * Asks the owner for a Mac, a known folder and a first message, then follows the order until it resolves.
 * @param props - The Macs, the known folders and what to pick first.
 * @returns The dialog; it closes itself once the Mac opened the window.
 */
export function HireDialog({
  macs,
  folders,
  initialMachineId,
  initialFolder,
  onClose,
}: HireDialogProps) {
  const pickable = macs.filter((mac) => !mac.block);
  const [pickedMac, setPickedMac] = useState(
    pickable.find((mac) => mac.machineId === initialMachineId)?.machineId ??
      pickable[0]?.machineId ??
      "",
  );
  const [pickedFolder, setPickedFolder] = useState(initialFolder ?? "");
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // True from the click until the server answers, so a second click cannot send a second order.
  const [posting, setPosting] = useState(false);
  // The Mac opened the window; the new desk shows up by itself.
  const phase = useOrderStatus(orderId, onClose);

  // Switched-off folders stay: they are known start folders; deleted ones are not offered.
  const macFolders = folders
    .filter(
      (folder) =>
        folder.machineId === pickedMac && folder.existsOnMac !== false,
    )
    .map((folder) => folder.path);
  const folder = macFolders.includes(pickedFolder)
    ? pickedFolder
    : (macFolders[0] ?? "");
  const sending = posting || phase.phase === "pending";
  const canSubmit =
    !sending && pickedMac !== "" && folder !== "" && message.trim() !== "";

  const submit = async () => {
    setRefusal(null);
    setPosting(true);
    const result = await postHire({
      machineId: pickedMac,
      folder,
      firstMessage: message,
    });
    setPosting(false);
    if (result.ok) setOrderId(result.order.orderId);
    else setRefusal(result.error);
  };

  const outcome = refusal ?? outcomeText(phase);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hire an employee"
      data-testid="hire-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-12"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void submit();
        }}
        // Scrolls inside the overlay, so the button stays reachable on a short screen or with the keyboard up.
        className="flex max-h-full w-[420px] max-w-full flex-col gap-10 overflow-y-auto border-2 border-border bg-bg p-12 text-sm"
      >
        <div className="flex items-center justify-between gap-8">
          <h2 className="text-lg font-bold">Hire an employee</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 px-8 text-lg leading-none hover:bg-btn-hover"
          >
            ×
          </button>
        </div>
        <label className="flex flex-col gap-4">
          Mac
          <select
            data-testid="hire-mac"
            value={pickedMac}
            disabled={sending}
            onChange={(event) => setPickedMac(event.target.value)}
            className="border-2 border-border bg-bg-dark p-6"
          >
            {macs.map((mac) => (
              <option
                key={mac.machineId}
                value={mac.machineId}
                disabled={mac.block !== undefined}
              >
                {mac.block
                  ? `${mac.machineName} · ${BLOCK_NOTES[mac.block]}`
                  : mac.machineName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-4">
          Folder
          <select
            data-testid="hire-folder"
            value={folder}
            disabled={sending}
            onChange={(event) => setPickedFolder(event.target.value)}
            className="border-2 border-border bg-bg-dark p-6"
          >
            {macFolders.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-4">
          First message
          <textarea
            data-testid="hire-message"
            // Focus inside the dialog is what makes Escape reach its key handler.
            // biome-ignore lint/a11y/noAutofocus: a modal dialog's first field takes focus
            autoFocus
            value={message}
            disabled={sending}
            rows={4}
            onChange={(event) => setMessage(event.target.value)}
            className="border-2 border-border bg-bg-dark p-6"
          />
        </label>
        {outcome && (
          <p
            role="status"
            data-testid="hire-outcome"
            className="text-xs font-bold"
          >
            {outcome}
          </p>
        )}
        <button
          type="submit"
          data-testid="hire-submit"
          disabled={!canSubmit}
          className="h-40 border-2 border-border bg-btn-bg px-10 hover:bg-btn-hover disabled:opacity-50"
        >
          {phase.phase === "notSent" ||
          phase.phase === "failed" ||
          phase.phase === "lostContact" ||
          phase.phase === "checkMac"
            ? "Try again"
            : "Hire"}
        </button>
      </form>
    </div>
  );
}

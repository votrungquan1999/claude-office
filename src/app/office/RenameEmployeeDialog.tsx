import { useState } from "react";
import { OWNER_NAME_MAX_LENGTH } from "@/shared/session";
import { employeeNameToSend } from "./renameRule";
import { useEscape } from "./useEscape";

interface RenameEmployeeDialogProps {
  /** The name the owner gave the employee; absent when it has none. */
  ownerName?: string;
  /** The name the employee gets when the owner gives none. */
  automaticName: string;
  /** Sends the typed name; resolves true when the server stored it. */
  onSave: (name: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * The dialog that renames one employee.
 * @param props - The names, the save handler and the close handler.
 * @returns The dialog.
 */
export function RenameEmployeeDialog({
  ownerName,
  automaticName,
  onSave,
  onClose,
}: RenameEmployeeDialogProps) {
  const [draft, setDraft] = useState(ownerName ?? automaticName);
  const [refused, setRefused] = useState(false);

  useEscape(onClose);

  const save = async () => {
    const name = employeeNameToSend(draft, { ownerName, automaticName });
    if (name === null || (await onSave(name))) onClose();
    else setRefused(true);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-12">
      <button
        type="button"
        data-testid="rename-backdrop"
        aria-label="Close rename dialog"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Rename employee"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="relative flex w-[420px] max-w-full flex-col gap-8 border-2 border-border bg-bg p-12 text-sm shadow-[6px_6px_0_var(--color-bg-dark)]"
      >
        <h3 className="text-xs font-bold uppercase">Rename employee</h3>
        <label className="flex flex-col gap-4 text-xs font-bold uppercase">
          Name
          <input
            // Focus moves into the dialog when it opens.
            // biome-ignore lint/a11y/noAutofocus: a dialog moves focus into itself
            autoFocus
            value={draft}
            maxLength={OWNER_NAME_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            className="border-2 border-border bg-bg-dark px-8 py-4 text-base font-normal normal-case"
          />
        </label>
        <p className="text-xs">
          Leave it empty to get the automatic name back: "{automaticName}".
        </p>
        {refused && (
          <p role="alert" className="text-xs font-bold">
            Could not rename. Try again.
          </p>
        )}
        <div className="flex justify-end gap-8">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}

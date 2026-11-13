import {
  ConnectionStatus,
  type ConnectionStatusProps,
} from "./ConnectionStatus";
import { TagFilter, type TagFilterProps } from "./TagFilter";

interface PhoneTopRowProps {
  /** The repo pill, shown as a bottom sheet. */
  tagFilter: Omit<TagFilterProps, "sheet">;
  /** How fresh the answer is. */
  status: Omit<ConnectionStatusProps, "inFlow">;
}

/**
 * The phone's row above the list or rooms: the repo pill and the status.
 * @param props - What the pill and the status show.
 * @returns A row of its own, so neither covers a room header.
 */
export function PhoneTopRow({ tagFilter, status }: PhoneTopRowProps) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-8 px-10 pt-4">
      <TagFilter {...tagFilter} sheet />
      <div className="ml-auto shrink-0">
        <ConnectionStatus {...status} inFlow />
      </div>
    </div>
  );
}

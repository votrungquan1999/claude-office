import { type ComponentProps, type Ref, useRef, useState } from "react";
import { StackedRooms } from "@/office/components/StackedRooms";
import { PhoneList } from "./list/PhoneList";
import { PhoneBottomBar } from "./PhoneBottomBar";
import { PhoneTopRow } from "./PhoneTopRow";

interface PhoneOfficeProps {
  /** The repo pill and the status line above the view. */
  topRow: ComponentProps<typeof PhoneTopRow>;
  /** Which view the phone remembers. */
  view: "list" | "rooms";
  /** Whether the first answer is in; the list needs no assets, so it shows with it. */
  answered: boolean;
  /** Whether the office assets are in; the rooms need them. */
  loaded: boolean;
  list: Omit<ComponentProps<typeof PhoneList>, "searchRef">;
  rooms: ComponentProps<typeof StackedRooms>;
  bar: {
    /** False while a sheet or drawer is open over the bar. */
    shown: boolean;
    wentHomeCount: number;
    onWentHome: () => void;
    wentHomeRef: Ref<HTMLButtonElement>;
    onHire: () => void;
  };
}

/**
 * The phone's screen below the company strip: the repo pill and status, the List or Rooms view, and the bottom bar.
 * @param props - What each part shows and does.
 * @returns A column that fills the space under the strip.
 */
export function PhoneOffice({
  topRow,
  view,
  answered,
  loaded,
  list,
  rooms,
  bar,
}: PhoneOfficeProps) {
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  // The bar's Search button focuses the list's field from inside the tap, so iOS opens the keyboard
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex h-full flex-col">
      <PhoneTopRow
        {...topRow}
        tagFilter={{ ...topRow.tagFilter, onOpenChange: setTagSheetOpen }}
      />
      <div className="min-h-0 flex-1">
        {view === "list" && answered && (
          <PhoneList {...list} searchRef={searchRef} />
        )}
        {view === "rooms" && loaded && <StackedRooms {...rooms} />}
      </div>
      {bar.shown && !tagSheetOpen && (
        <PhoneBottomBar
          rooms={
            view === "rooms"
              ? {
                  wentHomeCount: bar.wentHomeCount,
                  onWentHome: bar.onWentHome,
                  wentHomeRef: bar.wentHomeRef,
                }
              : undefined
          }
          onSearch={() => searchRef.current?.focus()}
          onHire={bar.onHire}
        />
      )}
    </div>
  );
}

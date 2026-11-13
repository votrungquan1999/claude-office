import type { SessionState } from "@/shared/session-state";
import { CharacterMugShot } from "./CharacterMugShot";

export interface AgentCardData {
  /** The renderer's id for the employee. */
  id: number;
  deskName: string;
  machineName: string;
  state: SessionState;
  palette: number;
  hueShift: number;
}

interface MobileAgentBarProps {
  cards: AgentCardData[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

const DOT_COLOR: Record<SessionState, string> = {
  working: "var(--color-status-active)",
  thinking: "var(--color-status-active)",
  needsPermission: "var(--color-status-permission)",
  waitingForYou: "var(--color-room-waiting-for-you)",
  review: "var(--color-room-review)",
  idle: "var(--color-status-success)",
  wentHome: "var(--color-btn-bg)",
};

/**
 * A scrolling strip with one card per employee along the bottom of a phone screen; a tap selects.
 * @param props - The cards, the selected employee and the tap handler.
 * @returns The bar.
 */
export function MobileAgentBar({
  cards,
  selectedId,
  onSelect,
}: MobileAgentBarProps) {
  return (
    <nav
      data-testid="agent-card-bar"
      className="flex shrink-0 gap-2 overflow-x-auto border-t-2 border-border bg-bg p-2"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          data-testid="agent-card"
          onClick={() => onSelect(card.id)}
          className={`flex w-48 shrink-0 items-center gap-2 border-2 p-1 text-left ${
            card.id === selectedId
              ? "border-accent bg-active-bg"
              : "border-transparent bg-btn-bg"
          }`}
        >
          <CharacterMugShot palette={card.palette} hueShift={card.hueShift} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{card.deskName}</span>
            <span className="block truncate text-xs">{card.machineName}</span>
          </span>
          <span
            className="size-6 shrink-0"
            style={{ background: DOT_COLOR[card.state] }}
          />
        </button>
      ))}
    </nav>
  );
}

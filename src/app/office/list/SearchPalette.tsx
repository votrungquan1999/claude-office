import { useEffect, useRef, useState } from "react";
import { remoteControlOf } from "@/office/remoteControl";
import { wentHomeTime } from "@/office/wentHome";
import { employeeName } from "@/shared/employee-name";
import { fieldsOf, matchEmployee, rankMatches } from "@/shared/employee-search";
import { NEEDS_YOU_STATES } from "@/shared/needs-you";
import { type SessionDto, sessionKey } from "@/shared/session";
import { bandOf } from "../rowText";
import { MatchWhy } from "./MatchWhy";

const GROUPS = ["Needs you", "Everyone", "Went home today"] as const;

/**
 * The palette group an employee belongs to.
 * @param session - The employee's session.
 * @param offline - Whether its Mac is offline; an offline Mac's states are stale, so they do not ask for the owner.
 * @returns Went home today, Needs you or Everyone.
 */
function groupOf(
  session: SessionDto,
  offline: boolean,
): (typeof GROUPS)[number] {
  if (session.state === "wentHome") return "Went home today";
  const asks = (NEEDS_YOU_STATES as readonly string[]).includes(session.state);
  return asks && !offline ? "Needs you" : "Everyone";
}

interface SearchPaletteProps {
  /** Every employee of every company, went-home ones of today included. */
  sessions: SessionDto[];
  /** The name of the company a session belongs to. */
  companyNameOf: (session: SessionDto) => string;
  /** The Macs that are offline. */
  offlineMachineIds: ReadonlySet<string>;
  /** Shows the employee in the office. */
  onShow: (key: string) => void;
  onClose: () => void;
}

/**
 * The Cmd+K palette: finds an employee in any company and says why it matched.
 * @param props - The employees and what to do with a pick.
 * @returns The palette.
 */
export function SearchPalette({
  sessions,
  companyNameOf,
  offlineMachineIds,
  onShow,
  onClose,
}: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // The match Cmd+Enter could not open, so its row can say why
  const [noRemoteKey, setNoRemoteKey] = useState<string | null>(null);
  // The effect below must outlive re-renders, which hand it a new onClose each time
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // The drawers, dialogs and card listen for Escape on the document; capturing it first keeps them open under the palette
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, []);
  const found = [...sessions].flatMap((session) => {
    const match = matchEmployee(query, fieldsOf(session));
    const offline = offlineMachineIds.has(session.machineId);
    return match
      ? [{ session, match, offline, group: groupOf(session, offline) }]
      : [];
  });
  const groups = GROUPS.map((name) => ({
    name,
    hits: rankMatches(found.filter((hit) => hit.group === name)),
  })).filter((group) => group.hits.length > 0);
  // Arrow keys walk the groups top to bottom
  const matches = groups.flatMap((group) => group.hits);
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 pt-80">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Find an employee"
        className="flex max-h-[70%] w-[560px] max-w-[92%] flex-col border-2 border-border bg-bg-dark"
      >
        <input
          type="text"
          // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={
            matches[active] ? `search-option-${active}` : undefined
          }
          aria-label="Find an employee"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            // A Telex or other composition uses these keys to finish a letter; Safari ends it before the key reports 229
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((now) =>
                Math.min(Math.max(now + step, 0), matches.length - 1),
              );
            } else if (event.key === "Enter" && matches[active]) {
              const { session } = matches[active];
              if (!(event.metaKey || event.ctrlKey)) {
                onShow(sessionKey(session));
                return;
              }
              const url = remoteControlOf(session);
              if (url) window.open(url, "_blank", "noopener");
              else setNoRemoteKey(sessionKey(session));
            }
          }}
          className="h-48 border-b-2 border-border bg-transparent px-12 text-base outline-none"
        />
        <div
          id="search-results"
          role="listbox"
          aria-label="Matches"
          className="overflow-y-auto"
        >
          {groups.map((group) => (
            // biome-ignore lint/a11y/useSemanticElements: a listbox group is not a form fieldset
            <div key={group.name} role="group" aria-label={group.name}>
              <h3 className="px-12 pt-8 pb-2 text-xs text-text-muted">
                {group.name}
              </h3>
              {group.hits.map((hit) => {
                const { session, match, offline } = hit;
                const index = matches.indexOf(hit);
                const key = sessionKey(session);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input takes the keys
                  <div
                    key={key}
                    id={`search-option-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === active}
                    onClick={() => onShow(key)}
                    onMouseMove={() => setActive(index)}
                    ref={
                      index === active
                        ? (row) => row?.scrollIntoView?.({ block: "nearest" })
                        : undefined
                    }
                    className={`flex cursor-pointer items-center gap-8 px-12 py-6 ${index === active ? "bg-btn-hover" : ""}`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{employeeName(session)}</span>
                      <MatchWhy match={match} />
                    </span>
                    {noRemoteKey === key && (
                      <span className="shrink-0 text-xs text-text-muted">
                        Remote Control off
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-text-muted">
                      {bandOf(session, offline).text}
                      {session.state === "wentHome" && session.endedAt
                        ? ` ${wentHomeTime(session.endedAt)}`
                        : ""}
                    </span>
                    <span className="shrink-0 bg-accent/30 px-4 text-xs">
                      {companyNameOf(session)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="flex flex-wrap gap-x-16 border-t-2 border-border px-12 py-6 text-xs text-text-muted">
          <span>↑ ↓ move</span>
          <span>Enter show in the office</span>
          <span>⌘ Enter open Remote Control</span>
          <span>Search never changes your order</span>
        </p>
      </section>
    </div>
  );
}

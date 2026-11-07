"use client";

import { useState } from "react";
import {
  type SessionDto,
  type StepDto,
  stepsPageSchema,
} from "@/shared/session";

interface StepsListProps {
  session: SessionDto;
}

/** The session keeps exactly this many recent steps; a full list may have older ones behind it. */
const RECENT_STEPS = 5;

/** Steps expire from the database after a week; the session's embedded list can outlive that, so older ones are hidden. */
const STEP_VISIBLE_MS = 7 * 86_400_000;

/**
 * A run time in plain words.
 * @param rawMs - The run time in milliseconds.
 * @returns For example "120 ms", "4.5 s" or "2 min 5 s".
 */
function formatDuration(rawMs: number): string {
  // A run time is never shown below zero.
  const ms = Math.max(0, rawMs);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/**
 * Combines two step lists, one entry per step id with the later list's copy winning, oldest start first.
 * @param base - Steps already held.
 * @param incoming - Steps that replace or add to them.
 * @returns The merged list.
 */
function mergeById(base: StepDto[], incoming: StepDto[]): StepDto[] {
  const byId = new Map(base.map((step) => [step.id, step]));
  for (const step of incoming) byId.set(step.id, step);
  return [...byId.values()].sort(
    (a, b) =>
      a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id),
  );
}

/**
 * The steps of the selected session: older ones, the recent ones, then the running ones.
 * @param props - The selected session.
 * @returns The list with its "Show more" button.
 */
export function StepsList({ session }: StepsListProps) {
  const recent = session.recentSteps ?? [];
  const [older, setOlder] = useState<StepDto[]>([]);
  // Steps seen in the live list before newer ones pushed them out of it.
  const [kept, setKept] = useState<StepDto[]>([]);
  const [failed, setFailed] = useState(false);
  // Until "Show more" succeeds only the last RECENT_STEPS show, however many the list has seen.
  const [expanded, setExpanded] = useState(false);
  // undefined: not asked yet (a full recent list may have more behind it); null: nothing more.
  const [next, setNext] = useState<string | null | undefined>(undefined);
  if (recent.some((step) => !kept.some((k) => k.id === step.id))) {
    setKept(mergeById(kept, recent));
  }
  const oldest = [...recent].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  )[0];
  const cursor =
    next === undefined
      ? recent.length >= RECENT_STEPS && oldest
        ? `${oldest.startedAt},${oldest.id}`
        : null
      : next;

  /** Fetches the next page of older steps and puts it above what is shown; a failure shows a message and can be retried. */
  async function showMore(): Promise<void> {
    if (!cursor) return;
    const params = new URLSearchParams({
      machineId: session.machineId,
      sessionId: session.sessionId,
      before: cursor,
    });
    try {
      const response = await fetch(`/api/office/steps?${params}`);
      if (!response.ok)
        throw new Error(`Steps request failed: ${response.status}`);
      const page = stepsPageSchema.parse(await response.json());
      setOlder((current) => mergeById(current, page.steps));
      setNext(page.next ?? null);
      setExpanded(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  const visibleSince = Date.now() - STEP_VISIBLE_MS;
  const inWindow = mergeById(mergeById(older, kept), recent).filter(
    (step) => Date.parse(step.startedAt) >= visibleSince,
  );
  const shown = expanded ? inWindow : inWindow.slice(-RECENT_STEPS);
  const lines = shown.map((step) => ({
    key: step.id,
    text: [
      step.text,
      step.durationMs === undefined ? null : formatDuration(step.durationMs),
      step.status === "ok" ? null : step.status,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
  for (const [index, running] of (session.runningSteps ?? []).entries()) {
    lines.push({
      key: `running-${index}-${running.startedAt}-${running.text}`,
      text: `${running.text} · running`,
    });
  }

  return (
    <div>
      {failed && <p role="alert">Could not load older steps. Try again.</p>}
      {cursor && (
        <button type="button" onClick={() => void showMore()}>
          Show more
        </button>
      )}
      <ul data-testid="steps-list">
        {lines.map((line) => (
          <li key={line.key}>{line.text}</li>
        ))}
      </ul>
    </div>
  );
}

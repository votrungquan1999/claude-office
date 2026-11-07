import { type FSWatcher, readdirSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const kanbanCardSchema = z.object({
  summary: z.string().optional(),
  title: z.string().optional(),
});

export interface KanbanCard {
  summary?: string;
  title?: string;
}

export interface KanbanWatchOptions {
  /** `~/.claude/kanban-session-state`. */
  dir: string;
  pollMs: number;
  /** Called when a session's card first appears, changes, or disappears (`undefined`). */
  onCard: (sessionId: string, card: KanbanCard | undefined) => void;
}

export interface KanbanWatch {
  stop(): void;
}

/**
 * Follows the AI-Kanban session files so a card created, renamed or removed after the session
 * started still reaches its desk.
 * @param options - The folder, the re-scan interval and the change callback.
 * @returns A handle to stop watching.
 */
export function startKanbanWatch(options: KanbanWatchOptions): KanbanWatch {
  const known = new Map<string, string>();

  const scan = () => {
    let files: string[];
    try {
      files = readdirSync(options.dir).filter((file) => file.endsWith(".json"));
    } catch {
      // No folder yet means no cards; the next poll looks again.
      return;
    }
    const seen = new Set<string>();
    for (const file of files) {
      const sessionId = file.slice(0, -".json".length);
      let card: KanbanCard;
      try {
        card = kanbanCardSchema.parse(
          JSON.parse(readFileSync(join(options.dir, file), "utf8")),
        );
      } catch {
        // Half-written or gone since the listing: keep the card as it was and retry on the next scan.
        seen.add(sessionId);
        continue;
      }
      seen.add(sessionId);
      const json = JSON.stringify(card);
      if (known.get(sessionId) === json) continue;
      known.set(sessionId, json);
      options.onCard(sessionId, card);
    }
    for (const sessionId of [...known.keys()]) {
      if (seen.has(sessionId)) continue;
      known.delete(sessionId);
      options.onCard(sessionId, undefined);
    }
  };

  // macOS file events miss some atomic rewrites, so the poll is the backstop.
  const timer = setInterval(scan, options.pollMs);
  timer.unref();
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(options.dir, scan);
    // Polling backs the watcher up; an unhandled watcher error would crash the agent.
    watcher.on("error", () => {});
  } catch {
    // The folder may not exist yet; polling alone covers that.
  }
  scan();
  return {
    stop() {
      clearInterval(timer);
      watcher?.close();
    },
  };
}

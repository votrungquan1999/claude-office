import { describe, expect, it } from "vitest";
import {
  loadSeenRows,
  markSeen,
  SEEN_ROWS_LIMIT,
  type SeenStorage,
} from "./seenRows";

/** An in-memory storage that starts with the given text under the seen key's name. */
function storageWith(initial: string | null) {
  const state = { raw: initial };
  const storage: SeenStorage = () => ({
    getItem: () => state.raw,
    setItem: (_name, value) => {
      state.raw = value;
    },
  });
  return { storage, state };
}

describe("the conversations this device has opened", () => {
  it("counts every conversation of the first answer as seen when nothing usable is stored, keeps a stored set as it is, and shows no dots when storage is unavailable", () => {
    // Given the keys of a first answer
    const keys = ["m/a", "m/b"];

    // When nothing is stored
    const fresh = storageWith(null);
    const first = loadSeenRows(fresh.storage, keys);

    // Then both count as seen, and that baseline is remembered
    expect([...(first ?? [])].sort()).toEqual(["m/a", "m/b"]);
    expect(JSON.parse(fresh.state.raw ?? "null")).toEqual(
      expect.arrayContaining(["m/a", "m/b"]),
    );

    // When the stored text is unreadable
    const garbage = storageWith("{not json");

    // Then it is treated like nothing stored
    expect([...(loadSeenRows(garbage.storage, keys) ?? [])].sort()).toEqual([
      "m/a",
      "m/b",
    ]);

    // When a set is stored that lacks a new conversation
    const stored = storageWith(JSON.stringify(["m/a"]));

    // Then only the stored one is seen
    expect([...(loadSeenRows(stored.storage, keys) ?? [])]).toEqual(["m/a"]);

    // When storage cannot be reached
    const unavailable: SeenStorage = () => {
      throw new Error("blocked");
    };

    // Then there is no set, so no row gets a dot
    expect(loadSeenRows(unavailable, keys)).toBeNull();
  });

  it("remembers an opened conversation, keeps one that is not in the current answer, and forgets only the oldest ones past the limit", () => {
    // Given a device that has seen a conversation that is no longer listed
    const { storage, state } = storageWith(null);
    const seen = new Set(["m/a", "m/old"]);

    // When it opens a third
    const next = markSeen(storage, seen, "m/c");

    // Then all three are remembered, and the same is stored
    expect([...next].sort()).toEqual(["m/a", "m/c", "m/old"]);
    expect((JSON.parse(state.raw ?? "[]") as string[]).sort()).toEqual([
      "m/a",
      "m/c",
      "m/old",
    ]);

    // When the set is full and another conversation is opened
    const full = new Set(
      Array.from({ length: SEEN_ROWS_LIMIT }, (_, i) => `m/${i}`),
    );
    const capped = markSeen(storage, full, "m/new");

    // Then the oldest is forgotten and the new one is kept
    expect(capped.size).toBe(SEEN_ROWS_LIMIT);
    expect(capped.has("m/0")).toBe(false);
    expect(capped.has("m/new")).toBe(true);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionDto } from "@/shared/session";
import {
  buildTagFilter,
  SHOW_ALL,
  TagFilterKind,
  type TagFilterSelection,
} from "@/shared/tag-filter";
import { TagFilter } from "./TagFilter";

const tag = (name: string, key = name, parent?: string) => ({
  name,
  key,
  parent,
});

/**
 * A session of one Mac with the given repo tags.
 * @param id - The session id.
 * @param tags - Its repo tags.
 * @param state - Its state.
 * @returns The session as the browser receives it.
 */
function session(
  id: string,
  tags: Array<{ name: string; key: string; parent?: string }>,
  state: SessionDto["state"] = "idle",
): SessionDto {
  return {
    machineId: "m1",
    machineName: "Air",
    sessionId: id,
    cwd: "/personal",
    state,
    startedAt: "2026-11-09T09:00:00.000Z",
    changedAt: "2026-11-09T09:00:00.000Z",
    ...(tags.length ? { tags } : {}),
  };
}

describe("the repo tag filter", () => {
  afterEach(cleanup);

  it("lists All, each tag with its count by count then name, and no tag; a two-tag session counts under both and a session that went home counts nowhere", () => {
    // Given sessions: one with two tags, one with one, one with none, and a tagged one that went home
    const sessions = [
      session("s1", [tag("web"), tag("api")]),
      session("s2", [tag("api")]),
      session("s3", []),
      session("s4", [tag("zeta")], "wentHome"),
    ];

    // When the filter renders with All selected
    render(
      <TagFilter
        view={buildTagFilter(sessions, SHOW_ALL)}
        onSelect={() => {}}
      />,
    );

    // Then the chips read All 3 (sessions shown, not the sum), api 2, web 1, No tag 1, in a labelled landmark
    const nav = screen.getByRole("group", { name: "Filter by repo tag" });
    expect(
      Array.from(nav.querySelectorAll("button")).map((b) => b.textContent),
    ).toEqual(["All 3", "api 2", "web 1", "No tag 1"]);
  });

  it("keeps every count when a tag is selected, marks only it as pressed, and reports the owner's pick", () => {
    // Given the same sessions with the tag api selected
    const sessions = [
      session("s1", [tag("web"), tag("api")]),
      session("s2", [tag("api")]),
      session("s3", []),
    ];
    const picks: TagFilterSelection[] = [];
    const view = buildTagFilter(sessions, {
      kind: TagFilterKind.Tag,
      key: "api",
    });

    // When the filter renders and the owner presses the "No tag" chip
    render(<TagFilter view={view} onSelect={(pick) => picks.push(pick)} />);
    fireEvent.click(screen.getByRole("button", { name: "No tag 1" }));

    // Then the counts are those of the whole company, only api is pressed, and the pick is "no tag"
    expect(
      screen
        .getAllByRole("button")
        .map((b) => [b.textContent, b.getAttribute("aria-pressed")]),
    ).toEqual([
      ["All 3", "false"],
      ["api 2", "true"],
      ["web 1", "false"],
      ["No tag 1", "false"],
    ]);
    expect(picks).toEqual([{ kind: TagFilterKind.NoTag }]);
  });

  it("gives two same-named repos with different keys two chips, told apart by their key", () => {
    // Given two sessions whose repos are both called api
    const sessions = [
      session("s1", [tag("api", "1111aaaaaaaa")]),
      session("s2", [tag("api", "2222bbbbbbbb")]),
    ];

    // When the filter renders
    render(
      <TagFilter
        view={buildTagFilter(sessions, SHOW_ALL)}
        onSelect={() => {}}
      />,
    );

    // Then there are two api chips with different labels and keys
    const chips = screen.getAllByTestId("tag-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "api~1111 1",
      "api~2222 1",
    ]);
    expect(chips.map((chip) => chip.getAttribute("data-tag-key"))).toEqual([
      "1111aaaaaaaa",
      "2222bbbbbbbb",
    ]);
  });

  it("writes same-named repos as parent/name when their parent folders are known", () => {
    // Given two repos called api in different parent folders
    const sessions = [
      session("s1", [tag("api", "1111aaaaaaaa", "personal")]),
      session("s2", [tag("api", "2222bbbbbbbb", "work")]),
    ];

    // When the filter renders
    render(
      <TagFilter
        view={buildTagFilter(sessions, SHOW_ALL)}
        onSelect={() => {}}
      />,
    );

    // Then the chips read parent/name
    expect(
      screen.getAllByTestId("tag-chip").map((chip) => chip.textContent),
    ).toEqual(["personal/api 1", "work/api 1"]);
  });

  it("lengthens the key start of same-named repos whose keys begin alike", () => {
    // Given two repos called api whose keys share their first eight characters
    const sessions = [
      session("s1", [tag("api", "aaaabbbbcccc")]),
      session("s2", [tag("api", "aaaabbbbdddd")]),
    ];

    // When the filter renders
    render(
      <TagFilter
        view={buildTagFilter(sessions, SHOW_ALL)}
        onSelect={() => {}}
      />,
    );

    // Then the chips read differently
    expect(
      screen.getAllByTestId("tag-chip").map((chip) => chip.textContent),
    ).toEqual(["api~aaaabbbbc 1", "api~aaaabbbbd 1"]);
  });

  it("falls back to All when the selected tag, or an emptied no-tag choice, no longer exists, and hides itself when no session has a tag", () => {
    // Given a selected tag that no session carries any more
    const gone = buildTagFilter(
      [session("s1", [tag("web")]), session("s2", [])],
      {
        kind: TagFilterKind.Tag,
        key: "api",
      },
    );

    // And a no-tag choice when every session is tagged
    const allTagged = buildTagFilter([session("s1", [tag("web")])], {
      kind: TagFilterKind.NoTag,
    });

    // Then both show everyone under All
    expect(gone.selection).toEqual(SHOW_ALL);
    expect(allTagged.selection).toEqual(SHOW_ALL);
    expect(
      [session("s1", [tag("web")]), session("s2", [])].filter(gone.matches),
    ).toHaveLength(2);

    // And with no tags anywhere the filter renders nothing
    render(
      <TagFilter
        view={buildTagFilter([session("s1", [])], SHOW_ALL)}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.queryByRole("group", { name: "Filter by repo tag" }),
    ).toBeNull();
  });
});

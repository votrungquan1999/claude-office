import { describe, expect, it } from "vitest";
import { fieldsOf, matchEmployee, rankMatches } from "./employee-search";
import type { SessionDto } from "./session";

describe("matching an employee", () => {
  it("finds a query word at the start of a word in the name and cuts the name around the hit", () => {
    // Given an employee named "Fix LeaderboardPanel sort"
    const fields = { names: ["Fix LeaderboardPanel sort"] };

    // When the owner types the start of a word and then the middle of one
    const atStart = matchEmployee("lead", fields);
    const inMiddle = matchEmployee("board", fields);

    // Then the first is a Name match with the typed letters as the hit
    expect(atStart).toEqual({
      field: "name",
      snippet: { pre: "Fix ", hit: "Lead", post: "erboardPanel sort" },
    });

    // And the second matches nothing
    expect(inMiddle).toBeNull();
  });
});

describe("an empty query", () => {
  it("matches nothing", () => {
    expect(matchEmployee("  ", { names: ["anything"] })).toBeNull();
  });
});

describe("matching several words and fields", () => {
  const fields = {
    names: ["real vn30"],
    request: "what blocks deploying the live trading model",
    step: "Edit server.ts",
  };

  it("needs every query word inside one field, in any order, and names the field that held them", () => {
    // When every word is in the first request, in either order
    const request = matchEmployee("live trading", fields);
    const swapped = matchEmployee("trading live", fields);

    // Then it is a First request match and the hit spans from the first matched word to the last
    expect(request?.field).toBe("request");
    expect(swapped).toEqual(request);
    expect(request?.snippet.hit).toBe("live trading");

    // And words found in different fields do not match
    expect(matchEmployee("vn30 trading", fields)).toBeNull();

    // And a word of the latest step is a Last step match
    expect(matchEmployee("server", fields)?.field).toBe("step");
  });
});

describe("what counts as the start of a word", () => {
  it("starts a word after punctuation and at a capital letter inside a name, but not inside a plain word", () => {
    // Given a path-like name
    const fields = { names: ["src/LeaderboardPanel.tsx UBET-4597"] };

    // Then the capital inside the camel-case word, the part after a dot and after a dash all start words
    expect(matchEmployee("panel", fields)?.snippet.hit).toBe("Panel");
    expect(matchEmployee("tsx", fields)?.snippet.hit).toBe("tsx");
    expect(matchEmployee("4597", fields)?.snippet.hit).toBe("4597");

    // And the middle of a plain lower-case word does not
    expect(matchEmployee("eaderboard", fields)).toBeNull();
  });
});

describe("matching Vietnamese without typing accents", () => {
  it("finds accented text from plain letters, treats đ as d, and highlights the original letters", () => {
    // Given names with accents, one typed as a base letter plus a combining mark
    const composed = { names: ["Bài Đồng Nai chuyên Tin"] };
    const combining = { names: ["Nguyễn Du"] };

    // Then plain letters find them and the hit keeps the accents
    expect(matchEmployee("dong", composed)?.snippet).toEqual({
      pre: "Bài ",
      hit: "Đồng",
      post: " Nai chuyên Tin",
    });
    expect(matchEmployee("bai dong", composed)?.snippet.hit).toBe("Bài Đồng");
    expect(matchEmployee("nguyen", combining)?.snippet).toEqual({
      pre: "",
      hit: "Nguyễn",
      post: " Du",
    });

    // And an accent typed into the query finds the plain text too
    expect(
      matchEmployee("chuyên", { names: ["chuyen tin"] })?.snippet.hit,
    ).toBe("chuyen");
  });
});

describe("the snippet of a long text", () => {
  it("cuts a window around the hit with ellipses and flattens line breaks", () => {
    // Given a long request with the hit far from both ends and a line break nearby
    const request = `${"intro ".repeat(40)}show the new avatar\non the leaderboard rows, the profile page ${"outro ".repeat(40)}`;

    // When the hit is in the middle
    const match = matchEmployee("leaderboard", { names: [], request });

    // Then each side keeps about a line of context, marked as cut, on one line
    expect(match?.snippet).toEqual({
      pre: "… intro intro show the new avatar on the ",
      hit: "leaderboard",
      post: " rows, the profile page outro outro outro outro ou…",
    });
  });

  it("shows a short text whole, without ellipses", () => {
    expect(matchEmployee("live", { names: ["go live now"] })?.snippet).toEqual({
      pre: "go ",
      hit: "live",
      post: " now",
    });
  });
});

const session = (extra: Partial<SessionDto>): SessionDto => ({
  machineId: "m1",
  machineName: "Air",
  sessionId: "s1",
  cwd: "/Users/q/personal/claude-office",
  state: "idle",
  startedAt: "2026-11-14T00:00:00.000Z",
  changedAt: "2026-11-14T00:00:00.000Z",
  ...extra,
});

describe("the text search reads from an employee", () => {
  it("offers the owner's name, the automatic name apart from it, the request, and the running step before the latest finished one", () => {
    // Given an employee with both names, a request and steps both running and finished
    const fields = fieldsOf(
      session({
        ownerName: "real vn30",
        deskName: "Deploy daily model",
        request: "what blocks deploying",
        runningSteps: [
          { text: "Run tests", startedAt: "2026-11-14T00:00:00Z" },
        ],
        recentSteps: [
          { id: "a", text: "Read plan", startedAt: "x", status: "ok" },
          { id: "b", text: "Edit server.ts", startedAt: "x", status: "ok" },
        ],
      }),
    );

    // Then the automatic name is its own field, and the last step is the running one
    expect(fields).toEqual({
      names: ["real vn30"],
      automaticName: "Deploy daily model",
      request: "what blocks deploying",
      step: "Run tests",
    });

    // And with nothing running the latest finished step is used, and with no desk name the folder is the automatic name
    expect(
      fieldsOf(
        session({
          recentSteps: [
            { id: "a", text: "Read plan", startedAt: "x", status: "ok" },
            { id: "b", text: "Edit server.ts", startedAt: "x", status: "ok" },
          ],
        }),
      ),
    ).toEqual({ names: ["claude-office"], step: "Edit server.ts" });
  });
});

describe("a renamed employee's old automatic name", () => {
  it("is found, and the match says it is the Automatic name, while the owner's name stays a Name match", () => {
    // Given an employee the owner renamed
    const fields = {
      names: ["real vn30"],
      automaticName: "Deploy daily model",
    };

    // When the query hits the automatic name
    const old = matchEmployee("deploy", fields);
    // Then the match is labelled as the automatic name
    expect(old?.field).toBe("automatic");
    expect(old?.snippet.hit).toBe("Deploy");

    // And a hit on the owner's name is still a Name match
    expect(matchEmployee("vn30", fields)?.field).toBe("name");
  });
});

describe("ranking matches for the palette", () => {
  it("puts Name matches before First request before Last step and keeps the given order inside each", () => {
    const snippet = { pre: "", hit: "x", post: "" };
    const hit = (id: string, field: "name" | "request" | "step") => ({
      id,
      match: { field, snippet },
    });

    const ranked = rankMatches([
      hit("a", "step"),
      hit("b", "request"),
      hit("c", "name"),
      hit("d", "request"),
      hit("e", "name"),
    ]);

    expect(ranked.map((r) => r.id)).toEqual(["c", "e", "b", "d", "a"]);
  });
});

describe("matching the conversation's tab name", () => {
  const base: SessionDto = {
    machineId: "m1",
    machineName: "Mac",
    sessionId: "s1",
    cwd: "/Users/q/personal/app",
    state: "idle",
    startedAt: "2026-11-14T00:00:00.000Z",
    changedAt: "2026-11-14T00:00:00.000Z",
    deskName: "Card summary about the weekly report",
    tabName: "real vn30",
  };

  it("finds an employee by its tab name when its desk shows a card summary, and says it matched the Tab name", () => {
    // When the owner types the name of the tab
    const match = matchEmployee("real vn30", fieldsOf(base));

    // Then it matches as a Tab name, not as a Name
    expect(match?.field).toBe("tab");
    expect(match?.snippet.hit).toBe("real vn30");

    // And a Name match on the desk still comes first
    expect(matchEmployee("weekly report", fieldsOf(base))?.field).toBe("name");
  });

  it("ranks a Tab name match after Name and before First request", () => {
    // Given one match of each kind
    const hit = (field: "name" | "tab" | "request" | "step") => ({
      match: { field, snippet: { pre: "", hit: "", post: "" } },
    });

    // When ranked
    const ranked = rankMatches([
      hit("step"),
      hit("request"),
      hit("tab"),
      hit("name"),
    ]);

    // Then the order is Name, Tab name, First request, Last step
    expect(ranked.map((h) => h.match.field)).toEqual([
      "name",
      "tab",
      "request",
      "step",
    ]);
  });
});

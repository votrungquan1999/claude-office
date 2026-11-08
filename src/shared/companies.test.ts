import { describe, expect, it } from "vitest";
import { buildCompanyTree } from "./companies";

const MAC = new Set(["m1"]);
const session = (sessionId: string, startCwd: string, machineId = "m1") => ({
  machineId,
  sessionId,
  cwd: startCwd,
  startCwd,
});

describe("the company tree", () => {
  it("groups a session started in a nested folder under the outermost folder as its project", () => {
    // Given two company folders and a session started inside the first
    const tree = buildCompanyTree({
      folders: [
        { machineId: "m1", path: "/Users/q/personal", companyMode: true },
        { machineId: "m1", path: "/Users/q/ubet", companyMode: true },
      ],
      sessions: [session("s1", "/Users/q/personal/claude-office")],
      machineIds: MAC,
    });

    // Then the companies are the two outer folders, and the session is a project of the first
    expect(tree.companies.map((c) => c.name)).toEqual(["personal", "ubet"]);
    expect(
      tree.companyOf(session("s1", "/Users/q/personal/claude-office")),
    ).toEqual({
      companyKey: tree.companies[0].key,
      companyName: "personal",
      project: "claude-office",
    });
    // And a session started at the company folder itself has no project
    expect(
      tree.companyOf(session("s2", "/Users/q/personal"))?.project,
    ).toBeUndefined();
  });

  it("turns the direct child folders of a switched-off folder into companies, and puts a session started in the off folder itself under Other", () => {
    // Given /w switched off, a session in /w/x/y and one in /w itself
    const tree = buildCompanyTree({
      folders: [{ machineId: "m1", path: "/w", companyMode: false }],
      sessions: [session("deep", "/w/x/y"), session("home", "/w")],
      machineIds: MAC,
    });

    // Then the virtual folder /w/x is a company with y as the project, and Other comes last
    expect(tree.companies.map((c) => [c.name, c.other])).toEqual([
      ["x", false],
      ["Other", true],
    ]);
    expect(tree.companyOf(session("deep", "/w/x/y"))).toMatchObject({
      companyName: "x",
      project: "y",
    });
    // And the session at /w itself is in Other with its folder name as the project
    expect(tree.companyOf(session("home", "/w"))).toMatchObject({
      companyName: "Other",
      project: "w",
    });
  });

  it("lists Other for a Mac that has a switched-off folder even when no session is placed in it", () => {
    // Given /w switched off with a session below it only, and a second Mac with nothing switched off
    const tree = buildCompanyTree({
      folders: [
        { machineId: "m1", path: "/w", companyMode: false },
        { machineId: "m2", path: "/p", companyMode: true },
      ],
      sessions: [session("deep", "/w/x/y")],
      machineIds: new Set(["m1", "m2"]),
    });

    // Then the first Mac lists Other after its company, and the second has none
    expect(tree.companies.map((c) => [c.machineId, c.name, c.other])).toEqual([
      ["m1", "x", false],
      ["m1", "Other", true],
      ["m2", "p", false],
    ]);
  });

  it("hands the company job down at any depth when each level is switched off in turn", () => {
    // Given /a off, /a/b off, and sessions in /a/b/c/d and /a/z
    const tree = buildCompanyTree({
      folders: [
        { machineId: "m1", path: "/a", companyMode: false },
        { machineId: "m1", path: "/a/b", companyMode: false },
      ],
      sessions: [session("one", "/a/b/c/d"), session("two", "/a/z")],
      machineIds: MAC,
    });

    // Then the grandchildren become the companies
    expect(tree.companies.filter((c) => !c.other).map((c) => c.path)).toEqual([
      "/a/b/c",
      "/a/z",
    ]);
    expect(tree.companyOf(session("one", "/a/b/c/d"))).toMatchObject({
      companyName: "c",
      project: "d",
    });
    expect(tree.companyOf(session("two", "/a/z"))?.project).toBeUndefined();
  });

  it("ignores a switched-off flag on a folder inside a company, and keeps the session in that company", () => {
    // Given a company with a project folder whose own flag is off
    const tree = buildCompanyTree({
      folders: [
        { machineId: "m1", path: "/p", companyMode: true },
        { machineId: "m1", path: "/p/app", companyMode: false },
      ],
      sessions: [session("s", "/p/app")],
      machineIds: MAC,
    });

    // Then the flag changes nothing
    expect(tree.companies.map((c) => c.name)).toEqual(["p"]);
    expect(tree.companyOf(session("s", "/p/app"))).toMatchObject({
      companyName: "p",
      project: "app",
    });
  });

  it("compares folders by whole segments and treats a trailing slash as the same folder", () => {
    // Given /p and /p2, and a session recorded with a trailing slash
    const tree = buildCompanyTree({
      folders: [
        { machineId: "m1", path: "/p/", companyMode: true },
        { machineId: "m1", path: "/p2", companyMode: true },
      ],
      sessions: [session("s", "/p/x/")],
      machineIds: MAC,
    });

    // Then /p2 is not inside /p
    expect(tree.companies.map((c) => c.path)).toEqual(["/p", "/p2"]);
    expect(tree.companyOf(session("s", "/p/x/"))).toMatchObject({
      companyName: "p",
      project: "x",
    });
  });

  it("keeps Macs apart, ignores folders of a Mac with no record, and keeps Other's key from ever equalling a folder", () => {
    // Given the same folder on two Macs, a folder of an unknown Mac, and a folder named Other
    const tree = buildCompanyTree({
      folders: [
        { machineId: "m1", path: "/work", companyMode: true },
        { machineId: "m2", path: "/work", companyMode: true },
        { machineId: "ghost", path: "/lost", companyMode: true },
        { machineId: "m1", path: "/Other", companyMode: false },
      ],
      sessions: [session("a", "/work/x"), session("o", "/Other")],
      machineIds: new Set(["m1", "m2"]),
    });

    // Then each Mac has its own /work, the ghost has none, and Other's key is distinct
    const keys = tree.companies.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(tree.companies.map((c) => [c.machineId, c.name]).sort()).toEqual([
      ["m1", "Other"],
      ["m1", "work"],
      ["m2", "work"],
    ]);
    // And the folder named Other is switched off, so its session sits in the Mac's real Other
    expect(tree.companyOf(session("o", "/Other"))).toMatchObject({
      companyName: "Other",
      project: "Other",
    });
    expect(tree.companies.filter((c) => c.other)).toHaveLength(1);
  });

  it("adds the parent folder to the names of two companies on one Mac that share a name", () => {
    // Given two company folders both called app
    const tree = buildCompanyTree({
      folders: [
        { machineId: "m1", path: "/a/app", companyMode: true },
        { machineId: "m1", path: "/b/app", companyMode: true },
      ],
      sessions: [],
      machineIds: MAC,
    });

    // Then each name carries its parent
    expect(tree.companies.map((c) => c.name)).toEqual(["a/app", "b/app"]);
  });

  it("adds the parent folder to switched-off names that repeat among a Mac's companies and switched-off folders", () => {
    // Given /a/x and /b/x are both switched off, and a company /c/y is not
    const tree = buildCompanyTree({
      folders: [
        { machineId: "m1", path: "/a/x", companyMode: false },
        { machineId: "m1", path: "/b/x", companyMode: false },
        { machineId: "m1", path: "/c/y", companyMode: true },
      ],
      sessions: [
        { machineId: "m1", sessionId: "1", cwd: "/a/x/p", startCwd: "/a/x/p" },
        { machineId: "m1", sessionId: "2", cwd: "/b/x/q", startCwd: "/b/x/q" },
      ],
      machineIds: MAC,
    });

    // Then each switched-off name carries its parent, and the unique company keeps its short name
    expect(tree.switchedOff.map((f) => f.name).sort()).toEqual(["a/x", "b/x"]);
    expect(tree.companies.map((c) => c.name)).toContain("y");
  });

  it("makes the home folder the one company when a session starts there and every other folder is below it", () => {
    // Given a session started in the home folder and one deeper
    const tree = buildCompanyTree({
      folders: [],
      sessions: [session("h", "/Users/q"), session("d", "/Users/q/p/app")],
      machineIds: MAC,
    });

    // Then there is one company, q
    expect(tree.companies.map((c) => c.name)).toEqual(["q"]);
    expect(tree.companyOf(session("d", "/Users/q/p/app"))?.project).toBe(
      "p/app",
    );
  });
});

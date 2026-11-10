import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useMacHarness } from "./mac-harness";

describe("the agent tells the office which known folders still exist", () => {
  const { setUpMac } = useMacHarness();

  /** The Mac's folder records by path, with only the field under test. */
  async function existence(machineId: string) {
    const records = await (await getDb())
      .collection("folders")
      .find({ machineId })
      .toArray();
    return Object.fromEntries(
      records.map((record) => [record.path, record.existsOnMac]),
    );
  }

  it("marks a deleted folder missing on the next beat, marks it present again once recreated, and leaves another Mac's records alone", async () => {
    // Given known folders on two Macs, one of this Mac's folders on disk, and another Mac's record for a path that exists nowhere
    const mac = await setUpMac("machine-air", "Air");
    const kept = mac.fake.makeFolder("kept");
    const doomed = mac.fake.makeFolder("doomed");
    const db = await getDb();
    await db.collection("folders").insertMany(
      [
        ["machine-air", kept],
        ["machine-air", doomed],
        ["machine-mini", "/mini/only"],
      ].map(([machineId, path]) => ({
        machineId,
        path,
        companyMode: true,
        firstSeenAt: new Date(),
      })),
    );

    // When the next beat runs
    await mac.agent.heartbeat();

    // Then this Mac's existing folders read present and the other Mac's record is untouched
    expect(await existence("machine-air")).toEqual({
      [kept]: true,
      [doomed]: true,
    });
    expect(await existence("machine-mini")).toEqual({
      "/mini/only": undefined,
    });

    // When a folder is deleted, then recreated
    rmSync(doomed, { recursive: true });
    await mac.agent.heartbeat();
    expect((await existence("machine-air"))[doomed]).toBe(false);
    mac.fake.makeFolder("doomed");
    await mac.agent.heartbeat();

    // Then it reads present again
    expect((await existence("machine-air"))[doomed]).toBe(true);
  });

  /** The Mac's folder records by path, with only the trust field. */
  async function trustOf(machineId: string) {
    const records = await (await getDb())
      .collection("folders")
      .find({ machineId })
      .toArray();
    return Object.fromEntries(
      records.map((record) => [record.path, record.cliTrusted]),
    );
  }

  /** Inserts known-folder records for one Mac. */
  async function know(machineId: string, paths: string[]) {
    await (await getDb()).collection("folders").insertMany(
      paths.map((path) => ({
        machineId,
        path,
        companyMode: true,
        firstSeenAt: new Date(),
      })),
    );
  }

  it("reports each folder's trust from ~/.claude.json on the next beat without ever writing that file", async () => {
    // Given a trusted repo with a sub-folder, an explicitly refused folder, a trusted parent over a nested repo, a never-mentioned folder, and another Mac's record
    const mac = await setUpMac("machine-air", "Air");
    const repo = mac.fake.makeGitRoot("repo");
    const sub = mac.fake.makeFolder("repo/pkg");
    const refused = mac.fake.makeFolder("refused");
    const outer = mac.fake.makeFolder("outer");
    const nested = mac.fake.makeGitRoot("outer/nested");
    const unknown = mac.fake.makeFolder("unknown");
    mac.fake.trust(repo, true);
    mac.fake.trust(refused, false);
    mac.fake.trust(outer, true);
    await know("machine-air", [sub, refused, nested, unknown]);
    await know("machine-mini", ["/mini/only"]);
    const before = mac.fake.readClaudeJson();

    // When the next beat runs
    await mac.agent.heartbeat();

    // Then the sub-folder is trusted by its repo root, the refused one is untrusted, and the nested repo and the unmentioned folder are unknown
    expect(await trustOf("machine-air")).toEqual({
      [sub]: true,
      [refused]: false,
      [nested]: undefined,
      [unknown]: undefined,
    });
    // And the other Mac's record is untouched and the file's bytes are unchanged
    expect(await trustOf("machine-mini")).toEqual({ "/mini/only": undefined });
    expect(mac.fake.readClaudeJson()).toBe(before);
  });

  it("clears every folder's trust when ~/.claude.json cannot be read and says so once, without quoting the file", async () => {
    // Given a folder whose trust was reported while the file was readable
    const lines: string[] = [];
    const mac = await setUpMac("machine-air", "Air", {
      log: (line) => lines.push(line),
    });
    const repo = mac.fake.makeGitRoot("repo");
    mac.fake.trust(repo, true);
    await know("machine-air", [repo]);
    await mac.agent.heartbeat();
    expect(await trustOf("machine-air")).toEqual({ [repo]: true });

    // When the file disappears and two beats run
    lines.length = 0;
    mac.fake.removeClaudeJson();
    await mac.agent.heartbeat();
    await mac.agent.heartbeat();

    // Then the trust is unset (no warning), one line was logged, and it names no file contents
    const stored = await (await getDb())
      .collection("folders")
      .findOne({ machineId: "machine-air" });
    expect(stored).not.toHaveProperty("cliTrusted");
    const unreadable = lines.filter((line) => line.includes("trust"));
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]).not.toContain("hasTrustDialogAccepted");
  });
});

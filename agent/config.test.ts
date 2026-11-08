import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "./config";

describe("the saved connection's optional Anthropic key", () => {
  let home = "";
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  /** Writes a config.json holding the connection and the given key field, then reads it back. */
  function read(extra: Record<string, unknown>) {
    home = mkdtempSync(join(tmpdir(), "office-cfg-"));
    mkdirSync(join(home, ".claude-office"));
    writeFileSync(
      join(home, ".claude-office", "config.json"),
      JSON.stringify({ mongodbUri: "mongodb://x", mongodbDb: "d", ...extra }),
    );
    return readConfig(home);
  }

  it("reads a key, and treats a missing, empty or blank key as absent without failing the read", () => {
    expect(read({ anthropicApiKey: " sk-test-1 " })?.anthropicApiKey).toBe(
      "sk-test-1",
    );
    expect(read({})?.anthropicApiKey).toBeUndefined();
    expect(read({ anthropicApiKey: "" })?.anthropicApiKey).toBeUndefined();
    expect(read({ anthropicApiKey: "   " })?.anthropicApiKey).toBeUndefined();
  });
});

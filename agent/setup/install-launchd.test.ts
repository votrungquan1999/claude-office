import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeHome, makeFakeHome } from "../test/fake-home";
import {
  installLaunchAgent,
  LAUNCH_AGENT_LABEL,
  type LaunchctlResult,
} from "./install-launchd";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const onMac = process.platform === "darwin";

describe("the login job", () => {
  let fake: FakeHome;

  beforeEach(() => {
    fake = makeFakeHome("m-launchd");
    // The fixed path the plist points at, aimed at this checkout so tsx resolves from it.
    symlinkSync(REPO_ROOT, join(fake.home, ".claude", "claude-office"));
  });
  afterEach(() => fake.remove());

  const plistPath = () =>
    join(fake.home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);

  /** A launchctl that says a login session exists and nothing is loaded yet. */
  async function launchctl(args: string[]): Promise<LaunchctlResult> {
    return { code: args[0] === "print" ? 1 : 0, stdout: "", stderr: "" };
  }

  function plistAsJson(): Record<string, unknown> {
    return JSON.parse(
      execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath()], {
        encoding: "utf8",
      }),
    );
  }

  it.skipIf(!onMac)(
    "writes a valid plist that runs the agent through a stable node from the repo link, with logs and no secrets",
    async () => {
      // When setup installs the login job (nothing is loaded yet)
      await installLaunchAgent({
        home: fake.home,
        repoRoot: REPO_ROOT,
        uid: 501,
        launchctl,
        sleep: async () => {},
      });

      // Then the plist is valid and world-readable but holds no secrets
      expect(existsSync(plistPath())).toBe(true);
      execFileSync("plutil", ["-lint", plistPath()]);
      expect(statSync(plistPath()).mode & 0o777).toBe(0o644);
      const plist = plistAsJson();
      expect(plist.Label).toBe(LAUNCH_AGENT_LABEL);
      expect(plist.RunAtLoad).toBe(true);
      expect(plist.KeepAlive).toBe(true);
      expect(plist.EnvironmentVariables).toEqual({
        PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        CLAUDE_OFFICE_REPO: REPO_ROOT,
      });
      expect(JSON.stringify(plist)).not.toMatch(/mongodb/i);

      // And it starts node by an absolute, existing path that is not a versioned install folder
      const [node, ...args] = plist.ProgramArguments as string[];
      accessSync(node, constants.X_OK);
      expect(node.startsWith("/")).toBe(true);
      expect(node).not.toMatch(/Cellar|\.nvm|nvm\/versions/);
      const link = join(fake.home, ".claude", "claude-office");
      expect(args).toEqual(["--import", "tsx", join(link, "agent", "main.ts")]);

      // And tsx resolves from the working folder, since launchd's default is `/`
      expect(plist.WorkingDirectory).toBe(link);
      expect(existsSync(join(link, "node_modules", "tsx"))).toBe(true);

      // And logs go under the office folder, which exists
      const logs = join(fake.home, ".claude-office", "logs", "agent.log");
      expect(plist.StandardOutPath).toBe(logs);
      expect(plist.StandardErrorPath).toBe(logs);
      expect(existsSync(dirname(logs))).toBe(true);
    },
  );

  describe("reloading", () => {
    interface FakeLaunchd {
      run: (args: string[]) => Promise<LaunchctlResult>;
      /** Every launchctl verb except `print`, with the plist's text when it was called. */
      events: Array<{ verb: string; plist: string | undefined }>;
      loaded: () => boolean;
      printed: string[];
    }

    /** A launchd that remembers what is loaded; unloading takes two more looks, as the real one can. */
    function fakeLaunchd(start: {
      gui?: boolean;
      loaded?: boolean;
    }): FakeLaunchd {
      let loaded = start.loaded ?? false;
      let unloading = 0;
      const events: FakeLaunchd["events"] = [];
      const printed: string[] = [];
      const plist = () =>
        existsSync(plistPath()) ? readFileSync(plistPath(), "utf8") : undefined;
      return {
        events,
        printed,
        loaded: () => loaded,
        async run(args) {
          const [verb, target] = args;
          const ok = { code: 0, stdout: "", stderr: "" };
          if (verb === "print") {
            if (target === "gui/501") {
              return start.gui === false ? { ...ok, code: 113 } : ok;
            }
            if (loaded || unloading > 0) {
              unloading = Math.max(0, unloading - 1);
              return ok;
            }
            return { ...ok, code: 113 };
          }
          events.push({ verb, plist: plist() });
          if (verb === "bootout") {
            const was = loaded;
            loaded = false;
            unloading = was ? 2 : 0;
            return was ? ok : { ...ok, code: 3, stderr: "not loaded" };
          }
          if (verb === "bootstrap") {
            // The real one refuses while the old job is still going away.
            if (loaded || unloading > 0) {
              return { code: 5, stdout: "", stderr: "Input/output error" };
            }
            loaded = true;
            return ok;
          }
          throw new Error(`unexpected launchctl ${verb}`);
        },
      };
    }

    const install = (
      launchd: FakeLaunchd,
      extra: {
        nodeCandidates?: string[];
        print?: (line: string) => void;
        repoRoot?: string;
      } = {},
    ) =>
      installLaunchAgent({
        home: fake.home,
        repoRoot: REPO_ROOT,
        uid: 501,
        launchctl: launchd.run,
        sleep: async () => {},
        nodeVersion: () => "v24.0.0",
        nodeCandidates: [process.execPath],
        ...extra,
      });

    it("installs a new job as bootout, write, bootstrap, and leaves it loaded", async () => {
      const launchd = fakeLaunchd({});
      const result = await install(launchd);

      expect(result.state).toBe("installed");
      expect(launchd.events.map((event) => event.verb)).toEqual([
        "bootout",
        "bootstrap",
      ]);
      expect(launchd.events[0].plist).toBeUndefined();
      expect(launchd.events[1].plist).toContain(LAUNCH_AGENT_LABEL);
      expect(launchd.loaded()).toBe(true);
    });

    it("does nothing when the same plist is already loaded", async () => {
      const launchd = fakeLaunchd({});
      await install(launchd);
      const modified = statSync(plistPath()).mtimeMs;
      launchd.events.length = 0;

      const result = await install(launchd);

      expect(result.state).toBe("unchanged");
      expect(launchd.events).toEqual([]);
      expect(statSync(plistPath()).mtimeMs).toBe(modified);
    });

    it("restarts the running agent when setup is run from a checkout that moved", async () => {
      // Given a loaded job installed from one checkout
      const launchd = fakeLaunchd({});
      await install(launchd);
      launchd.events.length = 0;

      // When setup runs again from another checkout path, with everything else the same
      const result = await install(launchd, {
        repoRoot: "/moved/claude-office",
      });

      // Then the job is unloaded and loaded again so the agent runs the new checkout's code
      expect(result.state).toBe("reloaded");
      expect(launchd.events.map((event) => event.verb)).toEqual([
        "bootout",
        "bootstrap",
      ]);
      expect(launchd.loaded()).toBe(true);
    });

    it("unloads the old job, then writes the new plist, then loads it, when the plist changed", async () => {
      // Given a loaded job
      const launchd = fakeLaunchd({});
      await install(launchd);
      const old = readFileSync(plistPath(), "utf8");
      launchd.events.length = 0;

      // When setup runs with a different node binary (a stand-in is enough to change the plist)
      const changed = await install(launchd, { nodeCandidates: ["/bin/sh"] });

      // Then the old text was still on disk at bootout and the new text at bootstrap
      expect(changed.state).toBe("reloaded");
      expect(launchd.events.map((event) => event.verb)).toEqual([
        "bootout",
        "bootstrap",
      ]);
      expect(launchd.events[0].plist).toBe(old);
      expect(launchd.events[1].plist).toContain("/bin/sh");
      expect(launchd.loaded()).toBe(true);
    });

    it("only loads the job when the plist is right but nothing is loaded", async () => {
      const launchd = fakeLaunchd({});
      await install(launchd);
      const job = `gui/501/${LAUNCH_AGENT_LABEL}`;
      await launchd.run(["bootout", job]);
      // Wait out the fake's slow unload, as the owner's `launchctl bootout` would have finished.
      while ((await launchd.run(["print", job])).code === 0);
      launchd.events.length = 0;

      const result = await install(launchd);

      expect(result.state).toBe("installed");
      expect(launchd.events.map((event) => event.verb)).toEqual(["bootstrap"]);
    });

    it("keeps the plist and asks to log in when the Mac has no desktop session", async () => {
      const launchd = fakeLaunchd({ gui: false });
      const printed: string[] = [];

      const result = await install(launchd, {
        print: (line) => printed.push(line),
      });

      expect(result.state).toBe("no-gui-session");
      expect(existsSync(plistPath())).toBe(true);
      expect(launchd.events).toEqual([]);
      expect(printed.join("\n")).toMatch(
        /log in to the Mac's desktop.*re-run setup/i,
      );
    });

    it("fails loudly with launchctl's reason when the job cannot be loaded", async () => {
      const launchd = fakeLaunchd({});
      const refusing = {
        ...launchd,
        run: async (args: string[]) =>
          args[0] === "bootstrap"
            ? { code: 5, stdout: "", stderr: "Bootstrap failed: 5" }
            : launchd.run(args),
      };

      await expect(install(refusing)).rejects.toThrow(/Bootstrap failed: 5/);
    });

    it("refuses to set up a login job when no node 24 or newer exists", async () => {
      const launchd = fakeLaunchd({});
      await expect(
        installLaunchAgent({
          home: fake.home,
          repoRoot: REPO_ROOT,
          uid: 501,
          launchctl: launchd.run,
          nodeCandidates: [process.execPath],
          nodeVersion: () => "v22.1.0",
        }),
      ).rejects.toThrow(/Node 24 or newer/);
      expect(existsSync(plistPath())).toBe(false);
    });
  });
});

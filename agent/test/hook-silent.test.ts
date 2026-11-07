import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTimeOf } from "./live-process";
import { runHook } from "./run-hook";

/** Slower than this and the hook could hold up a Claude Code session. */
const MAX_WALL_MS = 1800;

const EVENT = {
  hook_event_name: "PreToolUse",
  session_id: "s1",
  cwd: "/work",
  tool_name: "Read",
  tool_use_id: "t1",
};

interface Setup {
  /** The hook's stdin; a string is sent as-is. */
  payload?: object | string;
  holdStdin?: boolean;
  /** Env for the child; `HOME` is set to the fake home unless given. */
  env?: (home: string) => Record<string, string>;
}

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "claude-office-silent-"));
  mkdirSync(join(home, ".claude-office"), { recursive: true });
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function writeAgentFile(home: string, contents: object | string): string {
  const file = join(home, ".claude-office", "agent.json");
  writeFileSync(
    file,
    typeof contents === "string" ? contents : JSON.stringify(contents),
  );
  return file;
}

/** A TCP server standing in for the agent; `onConnection` decides how it misbehaves. */
async function fakeAgent(
  onConnection: (socket: Socket) => void,
): Promise<number> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    onConnection(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** The pid of a process that has already exited. */
function deadPid(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", ""]);
    const pid = child.pid ?? 0;
    child.on("close", () => resolve(pid));
  });
}

const respondOk = (socket: Socket) => {
  socket.on("data", () =>
    socket.end("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n"),
  );
};

describe("a Claude session is never slowed down, blocked or interrupted by the hook", () => {
  const cases: Array<[string, (home: string) => Promise<Setup | undefined>]> = [
    ["no agent.json (the agent never ran)", async () => undefined],
    [
      "an agent.json naming a dead process",
      async (home) => {
        writeAgentFile(home, {
          pid: await deadPid(),
          port: await closedPort(),
          token: "t",
        });
        return undefined;
      },
    ],
    [
      "a live process with nothing listening",
      async (home) => {
        writeAgentFile(home, {
          pid: process.pid,
          port: await closedPort(),
          token: "t",
        });
        return undefined;
      },
    ],
    [
      "an agent that accepts and never responds",
      async (home) => {
        const port = await fakeAgent((socket) => socket.on("data", () => {}));
        writeAgentFile(home, { pid: process.pid, port, token: "t" });
        return undefined;
      },
    ],
    [
      "an agent that accepts and never reads",
      async (home) => {
        const port = await fakeAgent((socket) => socket.pause());
        writeAgentFile(home, { pid: process.pid, port, token: "t" });
        return undefined;
      },
    ],
    [
      "an agent that sends headers and never finishes the answer",
      async (home) => {
        const port = await fakeAgent((socket) =>
          socket.on("data", () =>
            socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n"),
          ),
        );
        writeAgentFile(home, { pid: process.pid, port, token: "t" });
        return undefined;
      },
    ],
    [
      "an agent that is running normally",
      async (home) => {
        const port = await fakeAgent(respondOk);
        writeAgentFile(home, { pid: process.pid, port, token: "t" });
        return undefined;
      },
    ],
    [
      "malformed JSON on stdin",
      async (home) => {
        writeAgentFile(home, {
          pid: process.pid,
          port: await fakeAgent(respondOk),
          token: "t",
        });
        return { payload: "{not json" };
      },
    ],
    ["empty stdin", async () => ({ payload: "" })],
    [
      "10 MB of tool output on stdin",
      async (home) => {
        writeAgentFile(home, {
          pid: process.pid,
          port: await fakeAgent(respondOk),
          token: "t",
        });
        return {
          payload: JSON.stringify({
            ...EVENT,
            hook_event_name: "PostToolUse",
            tool_response: { content: "x".repeat(10 * 1024 * 1024) },
          }),
        };
      },
    ],
    [
      "a half-written agent.json",
      async (home) => {
        writeAgentFile(home, '{"pid": 12');
        return undefined;
      },
    ],
    [
      "an agent.json with fields of the wrong type",
      async (home) => {
        writeAgentFile(home, { pid: "12", port: "80", token: 5 });
        return undefined;
      },
    ],
    [
      "an agent.json the user cannot read",
      async (home) => {
        const file = writeAgentFile(home, {
          pid: process.pid,
          port: await closedPort(),
          token: "t",
        });
        chmodSync(file, 0o000);
        return undefined;
      },
    ],
    [
      "a home folder that does not exist",
      async () => ({
        env: (home: string) => ({ HOME: join(home, "missing") }),
      }),
    ],
    [
      "a stdin the parent never closes",
      async (home) => {
        writeAgentFile(home, {
          pid: process.pid,
          port: await fakeAgent(respondOk),
          token: "t",
        });
        return { holdStdin: true };
      },
    ],
  ];

  it.each(cases)(
    "exits 0, silent and fast with %s",
    async (_name, arrange) => {
      // Given a fake home arranged for the scenario
      const home = fakeHome();
      const setup = await arrange(home);

      // When Claude Code runs the hook
      const result = await runHook(
        home,
        setup?.payload ?? EVENT,
        setup?.env?.(home) ?? {},
        { holdStdin: setup?.holdStdin },
      );

      // Then it ends quickly with exit 0 and prints nothing, so the session is never affected
      expect({
        code: result.code,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr,
      }).toEqual({ code: 0, timedOut: false, stdout: "", stderr: "" });
      expect(result.wallMs).toBeLessThan(MAX_WALL_MS);
    },
    // Above the harness's 5 s kill limit, so a hang fails on timedOut, not on the test timeout.
    15_000,
  );
});

describe("the hook and an agent.json whose pid may have been reused", () => {
  /** The agent's address file for a live pid with the given recorded start time, plus a listener counting what reaches it. */
  async function arrange(procStart: string) {
    const home = fakeHome();
    let received = 0;
    const port = await fakeAgent((socket) =>
      socket.on("data", () => {
        received += 1;
        respondOk(socket);
      }),
    );
    writeAgentFile(home, {
      pid: process.pid,
      port,
      token: "secret",
      procStart,
    });
    return { home, received: () => received };
  }

  it("sends nothing to a pid whose start time is not the agent's", async () => {
    // Given an agent.json recorded by an agent that died, whose pid now belongs to another process
    const { home, received } = await arrange("Mon Jan  1 00:00:00 2001");

    // When a hook runs
    await runHook(home, EVENT);

    // Then the bearer token and the event never reach whatever listens there
    expect(received()).toBe(0);
  });

  it("still delivers to the process that matches the recorded start time", async () => {
    // Given an agent.json whose pid and start time are the live agent's
    const { home, received } = await arrange(
      startTimeOf(process.pid).replace(/\s+/g, " "),
    );

    // When a hook runs
    await runHook(home, EVENT);

    // Then the event arrives
    expect(received()).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { getDb } from "@/db/mongo";
import { useLiveProcesses } from "./live-process";
import { useMacHarness } from "./mac-harness";
import { pause, runHook } from "./run-hook";

describe("a desk is named after the session", () => {
  const { setUpMac, officeSessions } = useMacHarness();
  const processes = useLiveProcesses();

  it("uses the first real message cut short, skipping slash commands, and keeps it when later prompts come", async () => {
    // Given three sessions, one of which never gets a prompt (registry name only)
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "typed", cwd: "/work/a" });
    fake.addSession({
      sessionId: "quiet",
      cwd: "/work/b",
      name: "Registry name",
    });
    const send = (sessionId: string, event: string, prompt?: string) =>
      runHook(fake.home, {
        hook_event_name: event,
        session_id: sessionId,
        cwd: `/work/${sessionId}`,
        ...(prompt === undefined ? {} : { prompt }),
      });

    // When one session gets a command, a long first message, and a second message
    await send("typed", "SessionStart");
    await send("typed", "UserPromptSubmit", "/clear");
    await send(
      "typed",
      "UserPromptSubmit",
      `Fix the sign-in redirect loop ${"really ".repeat(20)}now`,
    );
    await send("typed", "UserPromptSubmit", "and then something else");
    await send("quiet", "SessionStart");
    await agent.flush();

    // Then the desk shows the first real message cut at 60 characters, and the quiet one its registry name
    const names = Object.fromEntries(
      (await officeSessions()).map((s) => [s.sessionId, s.deskName]),
    );
    expect(names).toEqual({
      typed: "Fix the sign-in redirect loop really really really really r…",
      quiet: "Registry name",
    });
  });

  it("shows the AI-Kanban card name, follows it when it is created, renamed or removed later, and ignores a half-written file", async () => {
    // Given a session that already shows its first message
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/a" });
    const event = (name: string, prompt?: string) =>
      runHook(fake.home, {
        hook_event_name: name,
        session_id: "s1",
        cwd: "/work/a",
        ...(prompt ? { prompt } : {}),
      });
    await event("SessionStart");
    await event("UserPromptSubmit", "Start of the work");
    await agent.flush();
    // The writer's throttle is huge in tests, so each look flushes what the watcher has queued.
    const deskName = async () => {
      await agent.flush();
      return (await officeSessions())[0]?.deskName;
    };
    expect(await deskName()).toBe("Start of the work");

    // When a card file appears later, the desk takes the card's summary
    fake.writeKanban("s1", { cardId: "c1", summary: "Card A" });
    await expect.poll(deskName, { timeout: 5000 }).toBe("Card A");

    // When the card is renamed
    fake.writeKanban("s1", { cardId: "c1", summary: "Card B" });
    await expect.poll(deskName, { timeout: 5000 }).toBe("Card B");

    // When the file is caught half-written, the name stays as it was
    fake.writeKanban("s1", '{ "cardId": "c1", "summ');
    await pause(400);
    expect(await deskName()).toBe("Card B");

    // When the summary is empty but the file has a title, the title is used
    fake.writeKanban("s1", { cardId: "c1", summary: "", title: "Card C" });
    await expect.poll(deskName, { timeout: 5000 }).toBe("Card C");

    // When the card file is removed, the desk goes back to the first message
    fake.removeKanban("s1");
    await expect.poll(deskName, { timeout: 5000 }).toBe("Start of the work");
  }, 30_000);

  it("shows a name given with /rename after the session appeared, when nothing else names the desk", async () => {
    // Given a session with a registry name and no prompt, already shown
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const live = await processes.live();
    fake.addSession({
      sessionId: "s1",
      cwd: "/work/a",
      name: "Old name",
      pid: live.pid,
      procStart: live.procStart,
    });
    await runHook(fake.home, {
      hook_event_name: "SessionStart",
      session_id: "s1",
      cwd: "/work/a",
    });
    await agent.flush();
    expect((await officeSessions())[0]?.deskName).toBe("Old name");

    // When the owner renames the session and the agent next checks the registry
    fake.updateSession("s1", { name: "New name" });
    await agent.reconcile();
    await agent.flush();

    // Then the desk shows the new name
    expect((await officeSessions())[0]?.deskName).toBe("New name");
  });

  it("drops the desk name when the card goes away and nothing else can name the desk", async () => {
    // Given a session whose only name comes from its card (command first, no registry name)
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    fake.addSession({ sessionId: "s1", cwd: "/work/a", name: "" });
    const send = (name: string, prompt?: string) =>
      runHook(fake.home, {
        hook_event_name: name,
        session_id: "s1",
        cwd: "/work/a",
        ...(prompt ? { prompt } : {}),
      });
    await send("SessionStart");
    await send("UserPromptSubmit", "/clear");
    fake.writeKanban("s1", { cardId: "c1", summary: "Card A" });
    const deskName = async () => {
      await agent.flush();
      return (await officeSessions())[0]?.deskName;
    };
    await expect.poll(deskName, { timeout: 5000 }).toBe("Card A");

    // When the card file is removed
    fake.removeKanban("s1");

    // Then the desk has no name any more
    await expect.poll(deskName, { timeout: 5000 }).toBeUndefined();
  }, 30_000);

  it("never shows the paste tag: the typed words beside a paste name the desk, wherever the paste sits", async () => {
    // Given sessions whose first message holds pastes in the real tag shape
    const { fake, agent } = await setUpMac("machine-air", "Quan's MacBook Air");
    const paste = (id: string, size: number) =>
      `<pasted_content id="${id}">${"P".repeat(size)}</pasted_content id="${id}">`;
    const prompts: Record<string, string> = {
      after: `\n\n${paste("d1", 2000)} fix the login redirect`,
      before: `fix the login redirect \n${paste("d1", 300)}`,
      both: `fix the login ${paste("d1", 300)} redirect ${paste("d2", 300)}`,
      several: `${paste("d1", 300)}${paste("d2", 300)} fix the login redirect`,
    };
    for (const sessionId of Object.keys(prompts)) {
      fake.addSession({ sessionId, cwd: `/work/${sessionId}`, name: "" });
      await runHook(fake.home, {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionId,
        cwd: `/work/${sessionId}`,
        prompt: prompts[sessionId],
      });
    }

    // When the agent publishes them
    await agent.flush();

    // Then each desk shows the typed words only
    const names = Object.fromEntries(
      (await officeSessions()).map((s) => [s.sessionId, s.deskName]),
    );
    expect(names).toEqual({
      after: "fix the login redirect",
      before: "fix the login redirect",
      both: "fix the login redirect",
      several: "fix the login redirect",
    });
  });

  it("shows 'Pasted text' for a paste-only message live and from a transcript, lets /rename beat it, and never stores the pasted text", async () => {
    // Given live paste-only sessions (one renamed) and running sessions found from transcripts
    const live = await processes.live();
    const live2 = await processes.live();
    const user = (text: string) => ({
      type: "user",
      cwd: "/work/a",
      isSidechain: false,
      message: { role: "user", content: text },
    });
    const block = (body: string) =>
      `<pasted_content id="d9">${body}</pasted_content id="d9">`;
    const { fake, agent } = await setUpMac(
      "machine-air",
      "Quan's MacBook Air",
      {
        beforeStart(home) {
          home.addSession({
            sessionId: "seed-only",
            cwd: "/work/a",
            name: "",
            pid: live.pid,
            procStart: live.procStart,
          });
          home.addTranscript("seed-only", [user(block("SEEDSECRETBODY"))]);
          home.addSession({
            sessionId: "seed-typed",
            cwd: "/work/a",
            pid: live2.pid,
            procStart: live2.procStart,
          });
          home.addTranscript("seed-typed", [
            user(`${block("SEEDSECRETBODY")} fix the login redirect`),
          ]);
        },
      },
    );
    fake.addSession({ sessionId: "only", cwd: "/work/only", name: "" });
    fake.addSession({
      sessionId: "renamed",
      cwd: "/work/renamed",
      name: "My own name",
    });
    for (const sessionId of ["only", "renamed"]) {
      await runHook(fake.home, {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionId,
        cwd: `/work/${sessionId}`,
        prompt: block("LIVESECRETBODY"),
      });
    }

    // When the agent publishes them
    await agent.flush();

    // Then paste-only desks show the placeholder or the owner's name, and the typed words win in a transcript
    const names = Object.fromEntries(
      (await officeSessions()).map((s) => [s.sessionId, s.deskName]),
    );
    expect(names).toEqual({
      only: "Pasted text",
      renamed: "My own name",
      "seed-only": "Pasted text",
      "seed-typed": "fix the login redirect",
    });

    // And no pasted text is anywhere in the database
    const db = await getDb();
    const dump: string[] = [];
    for (const { name } of await db.listCollections().toArray()) {
      dump.push(JSON.stringify(await db.collection(name).find({}).toArray()));
    }
    expect(dump.join("\n")).not.toMatch(/LIVESECRETBODY|SEEDSECRETBODY/);
  }, 60_000);
});

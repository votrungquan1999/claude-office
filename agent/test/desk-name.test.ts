import { describe, expect, it } from "vitest";
import { useMacHarness } from "./mac-harness";
import { pause, runHook } from "./run-hook";

describe("a desk is named after the session", () => {
  const { setUpMac, officeSessions } = useMacHarness();

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
});

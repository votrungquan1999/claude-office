// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MacBlock } from "@/office/offline";
import { HireDialog } from "./HireDialog";

const macs = [
  { machineId: "up", machineName: "Up Mac" },
  { machineId: "second", machineName: "Second Mac" },
  { machineId: "down", machineName: "Down Mac", block: MacBlock.Offline },
  { machineId: "old", machineName: "Old Mac", block: MacBlock.Outdated },
];
const folders = [
  { machineId: "up", path: "/work/app", companyMode: true },
  { machineId: "second", path: "/other/place", companyMode: true },
  { machineId: "up", path: "/work/off", companyMode: false },
  {
    machineId: "up",
    path: "/work/gone",
    companyMode: true,
    existsOnMac: false,
  },
];

describe("the hire dialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("greys Macs that cannot take orders, lists switched-off folders but not deleted ones, and sends the chosen Mac, folder and message", async () => {
    // Given the dialog on the online Mac and a server that accepts the hire
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ orderId: "o1", sessionId: "s1" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <HireDialog
        macs={macs}
        folders={folders}
        initialMachineId="up"
        initialFolder="/work/off"
        onClose={() => {}}
      />,
    );

    // Then the blocked Macs are disabled with their reason and the folder list skips the deleted one
    const options = within(screen.getByTestId("hire-mac")).getAllByRole(
      "option",
    ) as HTMLOptionElement[];
    expect(options.map((o) => [o.textContent, o.disabled])).toEqual([
      ["Up Mac", false],
      ["Second Mac", false],
      ["Down Mac · offline", true],
      ["Old Mac · update this Mac's agent", true],
    ]);
    expect(
      within(screen.getByTestId("hire-folder"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["/work/app", "/work/off"]);

    // And an empty message cannot be sent
    const submit = screen.getByTestId("hire-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    // When the owner types a message and submits
    fireEvent.change(screen.getByTestId("hire-message"), {
      target: { value: "Fix it" },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Then the request names the picked Mac, the preselected folder and the message
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/office/hire");
    expect(JSON.parse(init.body)).toEqual({
      machineId: "up",
      folder: "/work/off",
      firstMessage: "Fix it",
    });
  });

  it("sends the hire once when the owner submits twice before the server answers", async () => {
    // Given a server that never answers
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <HireDialog
        macs={macs}
        folders={folders}
        initialMachineId="up"
        initialFolder="/work/app"
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("hire-message"), {
      target: { value: "Fix it" },
    });

    // When the owner submits twice
    fireEvent.click(screen.getByTestId("hire-submit"));
    fireEvent.click(screen.getByTestId("hire-submit"));

    // Then only one request went out and the form is locked
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByTestId("hire-message") as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });

  const open = (initialMachineId: string | null = "up") =>
    render(
      <HireDialog
        macs={macs}
        folders={folders}
        initialMachineId={initialMachineId}
        initialFolder="/work/app"
        onClose={() => {}}
      />,
    );
  const submitWith = (text = "Go") => {
    fireEvent.change(screen.getByTestId("hire-message"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByTestId("hire-submit"));
  };
  const outcome = () => screen.getByTestId("hire-outcome").textContent;

  it("shows a Mac's refusal text as sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "That Mac is offline." }), {
          status: 409,
        }),
      ),
    );
    open();
    submitWith();
    await vi.waitFor(() => expect(outcome()).toBe("That Mac is offline."));
  });

  it("says in plain words that the message is too long and how long it may be", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "message too long" }), {
          status: 400,
        }),
      ),
    );
    open();
    submitWith();
    await vi.waitFor(() => expect(outcome()).toMatch(/100,000/));
    expect(outcome()).not.toBe("message too long");
  });

  it("says in plain words that the Mac no longer knows the folder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "unknown folder" }), {
          status: 400,
        }),
      ),
    );
    open();
    submitWith();
    await vi.waitFor(() => expect(outcome()).toMatch(/folder/i));
    expect(outcome()).not.toBe("unknown folder");
  });

  it("falls back to the first usable Mac when the viewed company's Mac cannot take orders", () => {
    open("down");
    expect((screen.getByTestId("hire-mac") as HTMLSelectElement).value).toBe(
      "up",
    );
  });

  it("lists the folders of the Mac the owner switches to", () => {
    open();
    fireEvent.change(screen.getByTestId("hire-mac"), {
      target: { value: "second" },
    });
    expect(
      within(screen.getByTestId("hire-folder"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["/other/place"]);
  });

  it("puts the cursor in the message box so Escape works on open", () => {
    open();
    expect(document.activeElement).toBe(screen.getByTestId("hire-message"));
  });

  it("says the office lost contact, and that the Mac may still run the hire, after 35 s of silence", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/hire")) {
          return new Response(
            JSON.stringify({ orderId: "o1", sessionId: "s1" }),
          );
        }
        throw new Error("offline");
      }),
    );
    try {
      open();
      submitWith();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(37_000);
      });
      expect(outcome()).toMatch(/lost contact/i);
      expect(outcome()).toMatch(/may still/i);
      expect(outcome()).not.toMatch(/not sent/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the owner to check the Mac when the order stays claimed for 2 minutes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async (url: string) =>
          url.includes("/hire")
            ? new Response(JSON.stringify({ orderId: "o1", sessionId: "s1" }))
            : new Response(
                JSON.stringify({ status: "claimed", ageMs: 125_000 }),
              ),
        ),
    );
    open();
    submitWith();
    await vi.waitFor(() => expect(outcome()).toMatch(/check the Mac/i));
  });
});

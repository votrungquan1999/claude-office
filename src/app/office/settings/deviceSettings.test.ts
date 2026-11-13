import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseDeviceSettings,
  readDeviceSettings,
  storeDeviceSettings,
} from "./deviceSettings";

describe("the settings remembered on this device", () => {
  it("shows the list on a phone unless Rooms is stored, and falls back to the default for anything unreadable", () => {
    // Then Rooms is read back, and nothing, a wrong value and garbage all give the list
    expect(parseDeviceSettings('{"phoneView":"rooms"}')).toEqual({
      phoneView: "rooms",
    });
    expect(parseDeviceSettings(null)).toEqual({ phoneView: "list" });
    expect(parseDeviceSettings('{"phoneView":"grid"}')).toEqual({
      phoneView: "list",
    });
    expect(parseDeviceSettings("{not json")).toEqual({ phoneView: "list" });
  });
});

describe("a device whose storage refuses writes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("still shows the choice made during this visit", () => {
    // Given storage that holds nothing and throws on every write
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("denied");
        },
      },
    });

    // When the owner picks Rooms
    storeDeviceSettings({ phoneView: "rooms" });

    // Then the settings read back show Rooms
    expect(readDeviceSettings().phoneView).toBe("rooms");
  });
});

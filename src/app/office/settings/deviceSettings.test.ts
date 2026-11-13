import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseDeviceSettings,
  readDeviceSettings,
  storeDeviceSettings,
} from "./deviceSettings";

describe("the settings remembered on this device", () => {
  it("shows the list on a phone unless Rooms is stored, and falls back to the default for anything unreadable", () => {
    // Then Rooms is read back, and nothing, a wrong value and garbage all give the list
    expect(parseDeviceSettings('{"phoneView":"rooms"}').phoneView).toBe(
      "rooms",
    );
    expect(parseDeviceSettings(null).phoneView).toBe("list");
    expect(parseDeviceSettings('{"phoneView":"grid"}').phoneView).toBe("list");
    expect(parseDeviceSettings("{not json").phoneView).toBe("list");
  });

  it("starts the list open, shows the count in the tab and lists other companies unless stored otherwise, one field at a time", () => {
    // Then nothing stored gives the defaults
    expect(parseDeviceSettings(null)).toEqual({
      phoneView: "list",
      listStart: "open",
      tabCount: true,
      needsYouOtherCompanies: true,
    });

    // And each stored choice is read back without touching the others
    expect(parseDeviceSettings('{"listStart":"folded"}')).toMatchObject({
      listStart: "folded",
      tabCount: true,
      needsYouOtherCompanies: true,
    });
    expect(
      parseDeviceSettings('{"tabCount":false,"needsYouOtherCompanies":false}'),
    ).toMatchObject({
      listStart: "open",
      tabCount: false,
      needsYouOtherCompanies: false,
    });

    // And a value of the wrong kind falls back for that field alone
    expect(
      parseDeviceSettings(
        '{"listStart":"half","tabCount":"no","phoneView":"rooms"}',
      ),
    ).toMatchObject({ listStart: "open", tabCount: true, phoneView: "rooms" });
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

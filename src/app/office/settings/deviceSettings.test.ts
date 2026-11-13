import { describe, expect, it } from "vitest";
import { parseDeviceSettings } from "./deviceSettings";

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

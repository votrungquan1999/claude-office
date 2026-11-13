import { useSyncExternalStore } from "react";
import { z } from "zod";

/** What this device remembers about how the office looks on it. */
export interface DeviceSettings {
  /** What a phone shows: the ordered list, or today's stacked rooms. */
  phoneView: "list" | "rooms";
  /** Whether the Mac's list starts open beside the office or folded to its strip, at every load. */
  listStart: "open" | "folded";
  /** Whether the browser tab's title carries the needs-you count. */
  tabCount: boolean;
  /** Whether the Mac's Needs you section also lists employees of the other companies. */
  needsYouOtherCompanies: boolean;
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  phoneView: "list",
  listStart: "open",
  tabCount: true,
  needsYouOtherCompanies: true,
};

const DEVICE_SETTINGS_STORAGE_KEY = "claude-office.settings";

// A field that is missing or of the wrong type takes its default
const settingsSchema = z.object({
  phoneView: z.enum(["list", "rooms"]).catch(DEFAULT_DEVICE_SETTINGS.phoneView),
  listStart: z
    .enum(["open", "folded"])
    .catch(DEFAULT_DEVICE_SETTINGS.listStart),
  tabCount: z.boolean().catch(DEFAULT_DEVICE_SETTINGS.tabCount),
  needsYouOtherCompanies: z
    .boolean()
    .catch(DEFAULT_DEVICE_SETTINGS.needsYouOtherCompanies),
});

/**
 * Reads the stored settings.
 * @param raw - The stored text, or null when nothing is stored.
 * @returns The settings; every field the text does not hold readably keeps its default.
 */
export function parseDeviceSettings(raw: string | null): DeviceSettings {
  if (raw === null) return DEFAULT_DEVICE_SETTINGS;
  // Storage text can be anything the browser kept
  try {
    const fields = settingsSchema.safeParse(JSON.parse(raw));
    return fields.success ? fields.data : DEFAULT_DEVICE_SETTINGS;
  } catch {
    return DEFAULT_DEVICE_SETTINGS;
  }
}

const listeners = new Set<() => void>();
// The snapshot must keep its identity until the stored text changes
let cached: { raw: string | null; settings: DeviceSettings } | null = null;

// The settings of this visit once storage has refused a write; they win over whatever storage holds.
let unsaved: DeviceSettings | null = null;

/**
 * The stored text, or null when there is none or storage is unavailable.
 * @returns The raw text.
 */
function storedText(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_SETTINGS_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The settings remembered on this device.
 * @returns The settings as stored now, or as chosen this visit when storage refused them; the same object while neither changes.
 */
export function readDeviceSettings(): DeviceSettings {
  if (unsaved) return unsaved;
  const raw = storedText();
  if (cached?.raw !== raw) cached = { raw, settings: parseDeviceSettings(raw) };
  return cached.settings;
}

/**
 * Remembers some settings on this device and tells every reader; the other settings stay as they were.
 * @param change - The settings to change.
 */
export function storeDeviceSettings(change: Partial<DeviceSettings>): void {
  const next = { ...readDeviceSettings(), ...change };
  try {
    window.localStorage.setItem(
      DEVICE_SETTINGS_STORAGE_KEY,
      JSON.stringify(next),
    );
    unsaved = null;
  } catch {
    // Readers show the change for this visit from memory; it is lost on reload.
    unsaved = next;
  }
  for (const listener of listeners) listener();
}

/**
 * The device settings, live: a change made anywhere on this device shows at once.
 * @returns The settings.
 */
export function useDeviceSettings(): DeviceSettings {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => void listeners.delete(onChange);
    },
    readDeviceSettings,
    () => DEFAULT_DEVICE_SETTINGS,
  );
}

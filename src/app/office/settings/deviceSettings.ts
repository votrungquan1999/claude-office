import { useSyncExternalStore } from "react";
import { z } from "zod";

/** What this device remembers about how the office looks on it. */
export interface DeviceSettings {
  /** What a phone shows: the ordered list, or today's stacked rooms. */
  phoneView: "list" | "rooms";
}

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = { phoneView: "list" };

const DEVICE_SETTINGS_STORAGE_KEY = "claude-office.settings";

// A field that is missing or of the wrong type takes its default
const settingsSchema = z.object({
  phoneView: z.enum(["list", "rooms"]).catch(DEFAULT_DEVICE_SETTINGS.phoneView),
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
 * @returns The settings as stored now; the same object while the stored text is unchanged.
 */
function readDeviceSettings(): DeviceSettings {
  const raw = storedText();
  if (cached?.raw !== raw) cached = { raw, settings: parseDeviceSettings(raw) };
  return cached.settings;
}

/**
 * Remembers some settings on this device and tells every reader; the other settings stay as they were.
 * @param change - The settings to change.
 */
export function storeDeviceSettings(change: Partial<DeviceSettings>): void {
  try {
    window.localStorage.setItem(
      DEVICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...readDeviceSettings(), ...change }),
    );
  } catch {
    // The change still shows for this visit through the readers below.
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

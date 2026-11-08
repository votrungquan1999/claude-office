import { useState, useSyncExternalStore } from "react";

/** A clock that notifies its subscribers once a second while anyone is subscribed. */
interface Clock {
  subscribe: (onTick: () => void) => () => void;
  read: () => number;
}

/**
 * Makes a clock whose reading only moves on its tick, so a render sees one stable time.
 * @returns The clock.
 */
function createClock(): Clock {
  let value = Date.now();
  return {
    subscribe: (onTick) => {
      // Catch up on subscribing: the reading may be older than the time spent mounting.
      value = Date.now();
      const timer = setInterval(() => {
        value = Date.now();
        onTick();
      }, 1000);
      return () => clearInterval(timer);
    },
    read: () => value,
  };
}

/**
 * The browser's current time in milliseconds, refreshed once a second while the component is mounted.
 * @returns The time of the latest tick.
 */
export function useNow(): number {
  const [clock] = useState(createClock);
  return useSyncExternalStore(clock.subscribe, clock.read, clock.read);
}

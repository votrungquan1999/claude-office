"use client";

import dynamic from "next/dynamic";

/** The office touches `window` at module load, so it never renders on the server. */
const OfficeView = dynamic(
  () => import("./OfficeView").then((module) => module.OfficeView),
  { ssr: false },
);

/**
 * Loads the office in the browser only.
 * @returns The office view.
 */
export function OfficeViewLoader() {
  return <OfficeView />;
}

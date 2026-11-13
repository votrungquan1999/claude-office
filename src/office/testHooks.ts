import { OFFICE_CANVAS_TEST_ID } from "./constants";
import type { OfficeState } from "./engine/officeState";
import { overlayProjection } from "./projection";
import { TILE_SIZE } from "./types";

interface OfficeTestHooks {
  getAreas: () => Array<{ label: string; color: string }>;
  getSeats: () => Array<{
    uid: string;
    col: number;
    row: number;
    areaLabel: string | null;
    assigned: boolean;
    pose: string;
    standing: boolean;
    /** 0 down, 1 left, 2 right, 3 up */
    facing: number;
  }>;
  getAgentSeats: () => Array<{
    id: number;
    seatId: string | null;
    areaLabel: string | null;
  }>;
  getCharacters: () => Array<{
    id: number;
    tileCol: number;
    tileRow: number;
    state: string;
    seatId: string | null;
    isActive: boolean;
    macOffline: boolean;
    bubbleType: "permission" | "waiting" | "asks" | null;
    pose: string;
    standing: boolean;
    /** 0 down, 1 left, 2 right, 3 up */
    dir: number;
  }>;
  /** Centre of a tile in CSS px relative to the canvas, through the renderer's own zoom and pan. */
  getTileCenter: (col: number, row: number) => { x: number; y: number } | null;
  selectAgent: (id: number) => void;
  /** The id of the selected employee, or null when none is selected. */
  getSelectedAgentId: () => number | null;
  /** The office's size in tiles. */
  getLayoutSize: () => { cols: number; rows: number };
  getZoom: () => number;
  getPan: () => { x: number; y: number };
}

declare global {
  interface Window {
    __officeTestHooks?: OfficeTestHooks;
  }
}

interface TestHookView {
  getOfficeState: () => OfficeState;
  getZoom: () => number;
  getPan: () => { x: number; y: number };
}

/**
 * Exposes read-only views of the scene on `window.__officeTestHooks` for e2e specs. The caller
 * guards it with `process.env.NEXT_PUBLIC_E2E`, so production bundles do not contain it.
 * @param view - Accessors for the live scene, zoom and pan.
 */
export function installTestHooks(view: TestHookView): void {
  window.__officeTestHooks = {
    getAreas: () =>
      (view.getOfficeState().getLayout().areas ?? []).map((area) => ({
        label: area.label,
        color: area.color,
      })),
    getSeats: () => {
      const office = view.getOfficeState();
      return [...office.seats.entries()].map(([uid, seat]) => ({
        uid,
        col: seat.seatCol,
        row: seat.seatRow,
        areaLabel: office.seatZone(uid),
        assigned: seat.assigned,
        pose: seat.pose,
        standing: seat.standing,
        facing: seat.facingDir,
      }));
    },
    getAgentSeats: () => {
      const office = view.getOfficeState();
      return [...office.characters.values()].map((ch) => ({
        id: ch.id,
        seatId: ch.seatId,
        areaLabel: ch.seatId ? office.seatZone(ch.seatId) : null,
      }));
    },
    getCharacters: () =>
      view
        .getOfficeState()
        .getCharacters()
        .map((ch) => ({
          id: ch.id,
          tileCol: ch.tileCol,
          tileRow: ch.tileRow,
          state: ch.state,
          seatId: ch.seatId,
          isActive: ch.isActive,
          macOffline: ch.macOffline === true,
          bubbleType: ch.bubbleType,
          pose: ch.pose,
          standing: ch.standing,
          dir: ch.dir,
        })),
    getTileCenter: (col, row) => {
      const canvas = document.querySelector(
        `[data-testid="${OFFICE_CANVAS_TEST_ID}"]`,
      );
      if (!canvas) return null;
      const projection = overlayProjection(
        view.getOfficeState().getLayout(),
        canvas.getBoundingClientRect(),
        view.getZoom(),
        view.getPan(),
        window.devicePixelRatio || 1,
      );
      return {
        x: projection.toScreenX((col + 0.5) * TILE_SIZE),
        y: projection.toScreenY((row + 0.5) * TILE_SIZE),
      };
    },
    getLayoutSize: () => {
      const { cols, rows } = view.getOfficeState().getLayout();
      return { cols, rows };
    },
    getZoom: view.getZoom,
    getPan: view.getPan,
    getSelectedAgentId: () => view.getOfficeState().selectedAgentId,
    selectAgent: (id) => {
      view.getOfficeState().selectedAgentId = id;
    },
  };
}

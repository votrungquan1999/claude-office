"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  CAMERA_FOLLOW_LERP,
  CAMERA_FOLLOW_SNAP_THRESHOLD,
  OFFICE_CANVAS_TEST_ID,
  PAN_MARGIN_FRACTION,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SCROLL_THRESHOLD,
} from "../constants";
import { startGameLoop } from "../engine/gameLoop";
import type { OfficeState } from "../engine/officeState";
import type { SelectionRenderState } from "../engine/renderer";
import { renderFrame } from "../engine/renderer";
import { TILE_SIZE } from "../types";
import { computeNormalModeCursor } from "./officeCanvasCursor";
import { useCanvasTouchGestures } from "./useCanvasTouchGestures";

interface OfficeCanvasProps {
  officeState: OfficeState;
  onClick: (agentId: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
  /** Whether the canvas draws its own area overlay and labels. */
  showAreas: boolean;
  /** Mobile two-step tap: the first tap on a character selects it (camera
   *  follow + status label), and only a second tap on the already-selected
   *  character fires onClick (opens its terminal). Desktop keeps single-click
   *  focus with tap-again-to-deselect. */
  tapSelectsFirst?: boolean;
}

export function OfficeCanvas({
  officeState,
  onClick,
  zoom,
  onZoomChange,
  panRef,
  showAreas,
  tapSelectsFirst = false,
}: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  // Middle-mouse pan state (imperative, no re-renders)
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  // Zoom scroll accumulator for trackpad pinch sensitivity
  const zoomAccumulatorRef = useRef(0);
  // Clamp pan so the map edge can't go past a margin inside the viewport
  const clampPan = useCallback(
    (px: number, py: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: px, y: py };
      const layout = officeState.getLayout();
      const mapW = layout.cols * TILE_SIZE * zoom;
      const mapH = layout.rows * TILE_SIZE * zoom;
      const marginX = canvas.width * PAN_MARGIN_FRACTION;
      const marginY = canvas.height * PAN_MARGIN_FRACTION;
      const maxPanX = mapW / 2 + canvas.width / 2 - marginX;
      const maxPanY = mapH / 2 + canvas.height / 2 - marginY;
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, px)),
        y: Math.max(-maxPanY, Math.min(maxPanY, py)),
      };
    },
    [officeState, zoom],
  );

  // Resize canvas backing store to device pixels (no DPR transform on ctx)
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    // No ctx.scale(dpr) — we render directly in device pixels
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    const stop = startGameLoop(canvas, {
      update: (dt) => {
        officeState.update(dt);
      },
      render: (ctx) => {
        // Canvas dimensions are in device pixels
        const w = canvas.width;
        const h = canvas.height;

        // Camera: smoothly center on the followed agent, or — while the greeter
        // is speaking the Intro — on the character+bubble center the IntroBubble
        // overlay feeds via greeterCameraTarget. An explicit follow (clicking an
        // agent) outranks the greeter target; a manual pan cancels both.
        const followCh =
          officeState.cameraFollowId !== null
            ? officeState.characters.get(officeState.cameraFollowId)
            : undefined;
        const cameraFocus = followCh ?? officeState.greeterCameraTarget;
        if (cameraFocus) {
          const layout = officeState.getLayout();
          const mapW = layout.cols * TILE_SIZE * zoom;
          const mapH = layout.rows * TILE_SIZE * zoom;
          const targetX = mapW / 2 - cameraFocus.x * zoom;
          const targetY = mapH / 2 - cameraFocus.y * zoom;
          const dx = targetX - panRef.current.x;
          const dy = targetY - panRef.current.y;
          if (
            Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD &&
            Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD
          ) {
            panRef.current = { x: targetX, y: targetY };
          } else {
            panRef.current = {
              x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
              y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
            };
          }
        }

        // Build selection render state
        const selectionRender: SelectionRenderState = {
          selectedAgentId: officeState.selectedAgentId,
          hoveredAgentId: officeState.hoveredAgentId,
          hoveredTile: officeState.hoveredTile,
          seats: officeState.seats,
          characters: officeState.characters,
        };

        const layout = officeState.getLayout();
        const { offsetX, offsetY } = renderFrame(
          ctx,
          w,
          h,
          officeState.tileMap,
          officeState.furniture,
          officeState.getCharacters(),
          zoom,
          panRef.current.x,
          panRef.current.y,
          selectionRender,
          undefined,
          layout.tileColors,
          layout.cols,
          layout.rows,
          layout.carpetTiles,
          layout.areas,
          layout.areaTiles,
          showAreas,
          null,
          officeState.pets,
        );
        offsetRef.current = { x: offsetX, y: offsetY };
      },
    });

    return () => {
      stop();
      observer.disconnect();
    };
  }, [officeState, resizeCanvas, zoom, panRef, showAreas]);

  // Convert CSS mouse coords to world (sprite pixel) coords
  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // CSS coords relative to canvas
      const cssX = clientX - rect.left;
      const cssY = clientY - rect.top;
      // Convert to device pixels
      const deviceX = cssX * dpr;
      const deviceY = cssY * dpr;
      // Convert to world (sprite pixel) coords
      const worldX = (deviceX - offsetRef.current.x) / zoom;
      const worldY = (deviceY - offsetRef.current.y) / zoom;
      return { worldX, worldY, screenX: cssX, screenY: cssY, deviceX, deviceY };
    },
    [zoom],
  );

  const screenToTile = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const pos = screenToWorld(clientX, clientY);
      if (!pos) return null;
      const col = Math.floor(pos.worldX / TILE_SIZE);
      const row = Math.floor(pos.worldY / TILE_SIZE);
      const layout = officeState.getLayout();
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows)
        return null;
      return { col, row };
    },
    [screenToWorld, officeState],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Handle middle-mouse panning
      if (isPanningRef.current) {
        const dpr = window.devicePixelRatio || 1;
        const dx = (e.clientX - panStartRef.current.mouseX) * dpr;
        const dy = (e.clientY - panStartRef.current.mouseY) * dpr;
        panRef.current = clampPan(
          panStartRef.current.panX + dx,
          panStartRef.current.panY + dy,
        );
        return;
      }

      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;
      const hitId = officeState.getCharacterAt(pos.worldX, pos.worldY);
      // Only run pet hit-test if no character was hit (avoids redundant work).
      const petId =
        hitId === null ? officeState.getPetAt(pos.worldX, pos.worldY) : null;
      const tile = screenToTile(e.clientX, e.clientY);
      officeState.hoveredTile = tile;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = computeNormalModeCursor({
          hitId,
          petId,
          selectedAgentId: officeState.selectedAgentId,
          tile,
          getSeatAtTile: (col, row) => officeState.getSeatAtTile(col, row),
          getSeat: (seatId) => officeState.seats.get(seatId),
          getCharacter: (id) => officeState.characters.get(id),
        });
      }
      officeState.hoveredAgentId = hitId;
    },
    [officeState, screenToWorld, screenToTile, panRef, clampPan],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle mouse button (button 1) starts panning
      if (e.button === 1) {
        e.preventDefault();
        // Break camera follow + greeter centering on manual pan
        officeState.breakCameraFollow();
        isPanningRef.current = true;
        panStartRef.current = {
          mouseX: e.clientX,
          mouseY: e.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y,
        };
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = "grabbing";
        return;
      }
    },
    [officeState, panRef],
  );

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) return;
    isPanningRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = "default";
  }, []);

  // Shared by mouse click and touch tap — both resolve a viewport point to a
  // character / pet / seat interaction.
  const performTap = useCallback(
    (clientX: number, clientY: number) => {
      const pos = screenToWorld(clientX, clientY);
      if (!pos) return;

      const hitId = officeState.getCharacterAt(pos.worldX, pos.worldY);
      if (hitId !== null) {
        // Dismiss any active bubble on click
        officeState.dismissBubble(hitId);
        // Two-step (mobile): first tap selects + follows so the status label
        // shows; only a repeat tap on the same character opens its terminal.
        // Deselection is tapping empty floor, as ever.
        if (tapSelectsFirst) {
          if (officeState.selectedAgentId === hitId) {
            onClick(hitId);
          } else {
            officeState.selectedAgentId = hitId;
            officeState.cameraFollowId = hitId;
          }
          return;
        }
        // Toggle selection: click same agent deselects, different agent selects
        if (officeState.selectedAgentId === hitId) {
          officeState.selectedAgentId = null;
          officeState.cameraFollowId = null;
        } else {
          officeState.selectedAgentId = hitId;
          officeState.cameraFollowId = hitId;
        }
        onClick(hitId);
        return;
      }

      // Pet hit: toggle the heart bubble.
      const petId = officeState.getPetAt(pos.worldX, pos.worldY);
      if (petId !== null) {
        const pet = officeState.pets.find((p) => p.id === petId);
        if (pet?.bubbleType) {
          officeState.dismissPetBubble(petId);
        } else {
          officeState.showPetBubble(petId);
        }
        return;
      }

      // Empty floor deselects
      officeState.selectedAgentId = null;
      officeState.cameraFollowId = null;
    },
    [officeState, onClick, screenToWorld, tapSelectsFirst],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => performTap(e.clientX, e.clientY),
    [performTap],
  );

  const handleMouseLeave = useCallback(() => {
    isPanningRef.current = false;
    officeState.hoveredAgentId = null;
    officeState.hoveredTile = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = "default";
  }, [officeState]);

  // Wheel: Ctrl+wheel to zoom, plain wheel/trackpad to pan
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Accumulate scroll delta, step zoom when threshold crossed
        zoomAccumulatorRef.current += e.deltaY;
        if (Math.abs(zoomAccumulatorRef.current) >= ZOOM_SCROLL_THRESHOLD) {
          const delta = zoomAccumulatorRef.current < 0 ? 1 : -1;
          zoomAccumulatorRef.current = 0;
          const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta));
          if (newZoom !== zoom) {
            onZoomChange(newZoom);
          }
        }
      } else {
        // Pan via trackpad two-finger scroll or mouse wheel
        const dpr = window.devicePixelRatio || 1;
        officeState.breakCameraFollow();
        panRef.current = clampPan(
          panRef.current.x - e.deltaX * dpr,
          panRef.current.y - e.deltaY * dpr,
        );
      }
    },
    [zoom, onZoomChange, officeState, panRef, clampPan],
  );

  // Attach wheel listener with { passive: false } so preventDefault() works.
  // React's onWheel is passive by default in modern browsers.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Touch: one-finger pan, two-finger pinch zoom, short tap = click.
  useCanvasTouchGestures({
    canvasRef,
    enabled: true,
    zoom,
    onZoomChange,
    panRef,
    clampPan,
    onManualPan: () => officeState.breakCameraFollow(),
    onTap: performTap,
  });

  // Prevent default middle-click browser behavior (auto-scroll)
  const handleAuxClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden bg-bg"
    >
      <canvas
        ref={canvasRef}
        data-testid={OFFICE_CANVAS_TEST_ID}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onAuxClick={handleAuxClick}
        onMouseLeave={handleMouseLeave}
        className="block touch-none"
      />
    </div>
  );
}

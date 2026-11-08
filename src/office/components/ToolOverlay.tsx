"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import {
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  CHARACTER_SITTING_OFFSET_PX,
  OVERLAY_BUBBLE_Z_INDEX,
  OVERLAY_LABEL_SELECTED_Z_INDEX,
  OVERLAY_LABEL_Z_INDEX,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from "../constants";
import type { OfficeState } from "../engine/officeState";
import { overlayProjection } from "../projection";
import { getCachedSprite } from "../sprites/spriteCache";
import {
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
} from "../sprites/spriteData";
import { CharacterState } from "../types";

/** Label shown while an employee waits on the owner's next message. */
const WAITING_INPUT_ACTIVITY_TEXT = "Waiting for input";

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  /** Plain-words activity per character id; absent ids read "Idle". */
  activity: Record<number, string>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/** A speech-bubble sprite blitted into a DOM canvas. Bubbles live in the DOM
 *  (not the office canvas) so they can stack ABOVE the status label panels —
 *  canvas content can never out-paint the DOM overlay. */
function OverlayBubble({
  cached,
  dpr,
}: {
  cached: HTMLCanvasElement;
  dpr: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = cached.width;
    canvas.height = cached.height;
    canvas.getContext("2d")?.drawImage(cached, 0, 0);
  }, [cached]);
  return (
    <canvas
      ref={canvasRef}
      className="block"
      style={{ width: cached.width / dpr, height: cached.height / dpr }}
    />
  );
}

export function ToolOverlay({
  officeState,
  agents,
  activity,
  containerRef,
  zoom,
  panRef,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  // dpr is also needed to size the bubble canvases in CSS px (OverlayBubble).
  const dpr = window.devicePixelRatio || 1;
  const project = overlayProjection(
    officeState.getLayout(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    dpr,
  );

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  return (
    <>
      {agents.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;

        // Speech bubble (permission dots / done checkmark) — rendered here in
        // the DOM, above the label panels (OVERLAY_BUBBLE_Z_INDEX over the label panels), for every
        // character regardless of label visibility. Mirrors the geometry the
        // canvas renderer used. The idle "Waiting for input" state speaks
        // through its label, not a bubble.
        let bubbleNode = null;
        if (
          ch.bubbleType &&
          !(ch.bubbleType === "waiting" && ch.waitingAwaitingInput)
        ) {
          const cachedBubble = getCachedSprite(
            ch.bubbleType === "permission"
              ? BUBBLE_PERMISSION_SPRITE
              : BUBBLE_WAITING_SPRITE,
            zoom,
          );
          const bubbleSittingOff =
            ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
          const alpha =
            ch.bubbleType === "waiting" &&
            ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC
              ? ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC
              : 1;
          bubbleNode = (
            <div
              className="absolute -translate-x-1/2 pointer-events-none"
              style={{
                left: project.toScreenX(ch.x),
                // Bubble bottom sits one sprite pixel above the character's
                // anchor: project the anchor, then lift by the bubble's own
                // device-pixel height plus one zoomed pixel, in CSS px.
                top:
                  project.toScreenY(
                    ch.y + bubbleSittingOff - BUBBLE_VERTICAL_OFFSET_PX,
                  ) -
                  (cachedBubble.height + zoom) / dpr,
                opacity: alpha,
                zIndex: OVERLAY_BUBBLE_Z_INDEX,
              }}
            >
              <OverlayBubble cached={cachedBubble} dpr={dpr} />
            </div>
          );
        }

        // Labels would pile up with dozens of employees, so only the hovered or
        // selected one gets a panel; the bubble renders regardless.
        if (!isSelected && !isHovered) {
          return bubbleNode && <Fragment key={id}>{bubbleNode}</Fragment>;
        }

        // Position above character
        const sittingOffset =
          ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = project.toScreenX(ch.x);
        const screenY = project.toScreenY(
          ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET,
        );

        const hasWaiting = ch.bubbleType === "waiting";
        const hasPermission = ch.bubbleType === "permission";
        let activityText = activity[id] ?? "Idle";
        if (hasPermission) activityText = "Needs approval";
        else if (hasWaiting && ch.waitingAwaitingInput)
          activityText = WAITING_INPUT_ACTIVITY_TEXT;
        // The Mac's last known state is stale, so the label says so instead.
        if (ch.macOffline) activityText = "Mac offline";
        const isActive = ch.isActive;

        let dotColor: string | null = null;
        if (hasPermission || hasWaiting) {
          dotColor = "var(--color-status-permission)";
        } else if (isActive) {
          dotColor = "var(--color-status-active)";
        }

        const hasExtraLines = !!ch.directoryName;

        return (
          <Fragment key={id}>
            {bubbleNode}
            <div
              className="absolute flex flex-col items-center -translate-x-1/2"
              style={{
                left: screenX,
                top: screenY - (hasExtraLines ? 34 : 28),
                pointerEvents: "none",
                filter: ch.macOffline ? "grayscale(1)" : undefined,
                zIndex: isSelected
                  ? OVERLAY_LABEL_SELECTED_Z_INDEX
                  : OVERLAY_LABEL_Z_INDEX,
              }}
              data-testid="agent-overlay"
              data-agent-id={id}
              data-offline={ch.macOffline ? "true" : undefined}
            >
              <div className="flex items-center border-border px-8 pt-2 pb-4 gap-5 pixel-panel whitespace-nowrap max-w-2xs">
                {dotColor && (
                  <span
                    className={`w-6 h-6 rounded-full shrink-0 ${isActive && !hasPermission && !hasWaiting ? "pixel-pulse" : ""}`}
                    style={{ background: dotColor }}
                  />
                )}
                <div className="flex flex-col gap-0 overflow-hidden">
                  <span
                    className="overflow-hidden text-ellipsis block leading-none"
                    style={{ fontSize: "22px" }}
                  >
                    {activityText}
                  </span>
                  {ch.directoryName && (
                    <span className="text-2xs leading-none overflow-hidden text-ellipsis block">
                      {ch.directoryName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

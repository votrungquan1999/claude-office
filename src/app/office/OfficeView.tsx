"use client";

import { useEffect, useRef, useState } from "react";
import { loadOfficeAssets } from "@/office/assetLoader";
import { OfficeCanvas } from "@/office/components/OfficeCanvas";
import { ToolOverlay } from "@/office/components/ToolOverlay";
import {
  ZOOM_DEFAULT_DPR_FACTOR,
  ZOOM_MAX,
  ZOOM_MIN,
} from "@/office/constants";
import { OfficeState } from "@/office/engine/officeState";
import { offlineMachineIds } from "@/office/offline";
import { createSceneSync } from "@/office/sceneSync";
import { installTestHooks } from "@/office/testHooks";
import { dayStartOf, todaysDepartures } from "@/office/wentHome";
import { type ChangesResponse, sessionKey } from "@/shared/session";
import { ConnectionStatus } from "./ConnectionStatus";
import { DetailsPanel } from "./DetailsPanel";
import { mergeSessions, type SessionMap } from "./officeStore";
import { RoomSigns } from "./RoomSigns";
import { useOfficeChanges } from "./useOfficeChanges";
import { WentHomeList } from "./WentHomeList";

/**
 * The office: the canvas, its room signs and the employee labels.
 * @returns The office view, filling its parent.
 */
export function OfficeView() {
  const [officeState] = useState(() => new OfficeState());
  const [loaded, setLoaded] = useState(false);
  const [sceneSync] = useState(() => createSceneSync(officeState));
  const [agentIds, setAgentIds] = useState<number[]>([]);
  const [sessions, setSessions] = useState<SessionMap>(new Map());
  const [offlineIds, setOfflineIds] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(() =>
    Math.max(
      ZOOM_MIN,
      Math.min(
        ZOOM_MAX,
        Math.round(ZOOM_DEFAULT_DPR_FACTOR * (window.devicePixelRatio || 1)),
      ),
    ),
  );
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<SessionMap>(new Map());
  // The browser's own midnight decides which departures count as today.
  const [dayStart] = useState(() => dayStartOf(new Date()).toISOString());

  /** Folds one answer into the sessions and the scene. */
  const onAnswer = (answer: ChangesResponse, firstLoad: boolean) => {
    const merged = mergeSessions(
      firstLoad ? new Map() : sessionsRef.current,
      answer.sessions,
    );
    sessionsRef.current = merged;
    // Judged against the server's clock: the phone's may be minutes off.
    const offline = offlineMachineIds(answer.machines, answer.serverNow);
    setSessions(merged);
    setOfflineIds(offline);
    sceneSync.apply([...merged.values()], {
      firstLoad,
      offlineMachineIds: offline,
    });
    setAgentIds(sceneSync.agentIds());
  };

  // Employees need the layout's seats, so polling starts only after the assets.
  const { lastUpdatedAt, connectionLost } = useOfficeChanges({
    enabled: loaded,
    dayStart,
    onAnswer,
    onUnauthorized: () => window.location.assign("/sign-in?next=%2F"),
  });

  useEffect(() => {
    // Layout goes in last inside the loader; the signs read it once this flips.
    void loadOfficeAssets(officeState).then(() => setLoaded(true));
  }, [officeState]);

  useEffect(() => {
    // A state flip is only acted on once it has held for the smoothing window, even when no poll follows.
    const timer = setInterval(() => sceneSync.tick(), 500);
    return () => clearInterval(timer);
  }, [sceneSync]);

  useEffect(() => {
    // A new day empties the list even when nothing else changes; hidden tabs throttle timers, so a return re-checks too.
    const refresh = () => setNow(new Date());
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_E2E) return;
    installTestHooks({
      getOfficeState: () => officeState,
      getZoom: () => zoomRef.current,
      getPan: () => panRef.current,
    });
  }, [officeState]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <OfficeCanvas
        officeState={officeState}
        onClick={(id) => setSelectedKey(sceneSync.sessionKeyOf(id) ?? null)}
        zoom={zoom}
        onZoomChange={setZoom}
        panRef={panRef}
        showAreas={false}
      />
      {loaded && (
        <>
          <RoomSigns
            officeState={officeState}
            containerRef={containerRef}
            zoom={zoom}
            panRef={panRef}
          />
          <ToolOverlay
            officeState={officeState}
            agents={agentIds}
            activity={{}}
            containerRef={containerRef}
            zoom={zoom}
            panRef={panRef}
            alwaysShowOverlay
          />
        </>
      )}
      <ConnectionStatus
        lastUpdatedAt={lastUpdatedAt}
        connectionLost={connectionLost}
        now={now.getTime()}
      />
      <WentHomeList
        departures={todaysDepartures([...sessions.values()], now)}
        onSelect={(session) => setSelectedKey(sessionKey(session))}
      />
      <DetailsPanel
        session={selectedKey ? (sessions.get(selectedKey) ?? null) : null}
        offlineMachineIds={offlineIds}
        onClose={() => {
          setSelectedKey(null);
          officeState.selectedAgentId = null;
        }}
      />
    </div>
  );
}

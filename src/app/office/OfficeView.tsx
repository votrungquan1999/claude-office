"use client";

import { useEffect, useRef, useState } from "react";
import { loadOfficeAssets } from "@/office/assetLoader";
import { MobileAgentBar } from "@/office/components/MobileAgentBar";
import { OfficeCanvas } from "@/office/components/OfficeCanvas";
import { ToolOverlay } from "@/office/components/ToolOverlay";
import { OfficeState } from "@/office/engine/officeState";
import { fitZoom } from "@/office/fitZoom";
import { useIsMobile } from "@/office/hooks/useIsMobile";
import { offlineMachineIds } from "@/office/offline";
import { createSceneSync } from "@/office/sceneSync";
import { installTestHooks } from "@/office/testHooks";
import { dayStartOf, todaysDepartures } from "@/office/wentHome";
import type { FolderDto } from "@/shared/folders";
import { buildOverview, resolveSelection } from "@/shared/overview";
import {
  type ChangesResponse,
  type MachineDto,
  type SessionDto,
  sessionKey,
} from "@/shared/session";
import { CompanyDrawer } from "./CompanyDrawer";
import { CompanyStrip } from "./CompanyStrip";
import { ConnectionStatus } from "./ConnectionStatus";
import { postCompanyMode } from "./companyMode";
import { DetailsPanel } from "./DetailsPanel";
import {
  applyOverrides,
  type ModeOverrides,
  mergeSessions,
  overrideKey,
  type SessionMap,
  settleOverrides,
} from "./officeStore";
import { RoomSigns } from "./RoomSigns";
import { useOfficeChanges } from "./useOfficeChanges";
import { WentHomeList } from "./WentHomeList";

/**
 * The last path segment of a folder.
 * @param cwd - A folder path.
 * @returns Its name.
 */
function folderName(cwd: string): string {
  return cwd.split("/").filter(Boolean).at(-1) ?? cwd;
}

const COMPANY_STORAGE_KEY = "claude-office.company";

/**
 * The company picked last time in this browser.
 * @returns Its key, or null when none is stored or storage is unavailable.
 */
function readStoredCompany(): string | null {
  try {
    return window.localStorage.getItem(COMPANY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Remembers the picked company in this browser.
 * @param key - The company key.
 */
function storeCompany(key: string): void {
  try {
    window.localStorage.setItem(COMPANY_STORAGE_KEY, key);
  } catch {
    // The pick still works for this visit.
  }
}

/** What the last answer left in the browser. */
interface OfficeData {
  sessions: SessionMap;
  machines: MachineDto[];
  folders: FolderDto[];
  /** Switches the owner pressed that no answer has confirmed yet. */
  overrides: ModeOverrides;
  offline: ReadonlySet<string>;
}

/**
 * The overview of everything the browser knows, with today's departures.
 * @param data - Sessions, Macs and folders.
 * @param now - The current time.
 * @returns The per-Mac overview.
 */
function overviewOf(data: OfficeData, now: Date) {
  const sessions = [...data.sessions.values()];
  return buildOverview({
    folders: applyOverrides(data.folders, data.overrides),
    sessions,
    machines: data.machines,
    offlineMachineIds: data.offline,
    departures: todaysDepartures(sessions, now),
  });
}

const STATUS_LINES = {
  working: "Working",
  thinking: "Thinking",
  needsPermission: "Needs permission",
  waitingForYou: "Waiting for you",
  idle: "Idle",
  wentHome: "Went home",
} as const;

/**
 * The label's status line for a session.
 * @param session - The session behind an employee.
 * @returns Its office state in plain words; a working session adds the step it is on.
 */
function statusLine(session: SessionDto): string {
  const line = STATUS_LINES[session.state];
  const step = session.runningSteps?.at(-1)?.text;
  return session.state === "working" && step ? `${line}: ${step}` : line;
}

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
  const [machines, setMachines] = useState<MachineDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [overrides, setOverrides] = useState<ModeOverrides>(new Map());
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [companyKey, setCompanyKey] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const containerRef = useRef<HTMLDivElement>(null);
  // Once the owner zooms by hand, resizing no longer re-fits the office.
  const userZoomed = useRef(false);
  const isMobile = useIsMobile();
  const dataRef = useRef<OfficeData>({
    sessions: new Map(),
    machines: [],
    folders: [],
    overrides: new Map(),
    offline: new Set(),
  });
  // The poll reads refs only, so the picked company lives in one too.
  const companyRef = useRef<string | null>(null);
  // The browser's own midnight decides which departures count as today.
  const [dayStart] = useState(() => dayStartOf(new Date()).toISOString());

  /**
   * Shows only the picked company's employees in the scene.
   * @param data - What the browser knows.
   * @param key - The picked company.
   * @param options - `sitDown` seats everyone without a spawn effect, as on a first load.
   */
  const showCompany = (
    data: OfficeData,
    key: string | null,
    options: { sitDown: boolean },
  ) => {
    const overview = overviewOf(data, new Date());
    const sessionList = [...data.sessions.values()];
    const only = new Set(
      sessionList
        .filter((s) => overview.tree.companyOf(s)?.companyKey === key)
        .map(sessionKey),
    );
    sceneSync.apply(sessionList, {
      firstLoad: options.sitDown,
      offlineMachineIds: data.offline,
      only,
    });
    setAgentIds(sceneSync.agentIds());
    // A panel left open on a session outside the company would point at nobody on screen.
    setSelectedKey((open) => (open && only.has(open) ? open : null));
  };

  /**
   * Makes data the browser's state and shows the company it resolves to.
   * @param data - What the browser now knows.
   * @param sitDown - Seat everyone without a spawn effect, as on a first load.
   */
  const commit = (data: OfficeData, sitDown: boolean) => {
    dataRef.current = data;
    setSessions(data.sessions);
    setOfflineIds(data.offline);
    setMachines(data.machines);
    setFolders(data.folders);
    setOverrides(data.overrides);
    // Resolved here from the merged data, so the first paint already shows the right company.
    const picked = resolveSelection(
      overviewOf(data, new Date()),
      companyRef.current ?? readStoredCompany(),
    );
    const changed = picked !== companyRef.current;
    companyRef.current = picked;
    setCompanyKey(picked);
    showCompany(data, picked, { sitDown: sitDown || changed });
  };

  /** Folds one answer into the sessions and the scene. */
  const onAnswer = (answer: ChangesResponse, firstLoad: boolean) => {
    commit(
      {
        sessions: mergeSessions(
          firstLoad ? new Map() : dataRef.current.sessions,
          answer.sessions,
        ),
        machines: answer.machines,
        folders: answer.folders,
        // A switch stays in force until an answer agrees, so a poll already in flight cannot flip it back.
        overrides: settleOverrides(dataRef.current.overrides, answer.folders),
        // Judged against the server's clock: the phone's may be minutes off.
        offline: offlineMachineIds(answer.machines, answer.serverNow),
      },
      firstLoad,
    );
  };

  /** Switches company mode at once and sends it; a refused request puts the old value back. */
  const setCompanyMode = async (
    machineId: string,
    path: string,
    companyMode: boolean,
  ) => {
    const key = overrideKey(machineId, path);
    setSwitchError(null);
    const pickBefore = companyRef.current;
    commit(
      {
        ...dataRef.current,
        overrides: new Map(dataRef.current.overrides).set(key, companyMode),
      },
      false,
    );
    const pickDuring = companyRef.current;
    const sent = await postCompanyMode({ machineId, path, companyMode });
    if (sent) return;
    // A later press on the same folder owns the pending value now, so this failure leaves it alone.
    if (dataRef.current.overrides.get(key) !== companyMode) return;
    const reverted = new Map(dataRef.current.overrides);
    reverted.delete(key);
    // The switch may have made the viewed company vanish and moved the pick; the owner has not chosen since, so the revert puts it back.
    if (companyRef.current === pickDuring) companyRef.current = pickBefore;
    commit({ ...dataRef.current, overrides: reverted }, false);
    setSwitchError("Could not change company mode. Try again.");
  };

  /** Opens the company drawer; a details panel left open would sit under it, so it closes. */
  const openDrawer = () => {
    setSwitchError(null);
    setSelectedKey(null);
    officeState.selectedAgentId = null;
    setDrawerOpen(true);
  };

  /** Closes the drawer and puts focus back on the button that opened it. */
  const closeDrawer = () => {
    setDrawerOpen(false);
    drawerButtonRef.current?.focus();
  };

  /** Switches the office to another company at once. */
  const selectCompany = (key: string) => {
    companyRef.current = key;
    setCompanyKey(key);
    storeCompany(key);
    showCompany(dataRef.current, key, { sitDown: true });
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
    const container = containerRef.current;
    if (!loaded || !container) return;
    const refit = () => {
      if (userZoomed.current) return;
      const { width, height } = container.getBoundingClientRect();
      const { cols, rows } = officeState.getLayout();
      setZoom(fitZoom(width, height, cols, rows, window.devicePixelRatio || 1));
    };
    // Rotation and window resizes change the canvas, so the fit follows them.
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [loaded, officeState]);

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

  const cards = agentIds.flatMap((id) => {
    const session = sessions.get(sceneSync.sessionKeyOf(id) ?? "");
    const character = officeState.characters.get(id);
    if (!session || !character) return [];
    return [
      {
        id,
        deskName: session.deskName ?? folderName(session.cwd),
        machineName: session.machineName,
        state: session.state,
        palette: character.palette,
        hueShift: character.hueShift,
      },
    ];
  });

  const activity = Object.fromEntries(
    agentIds.flatMap((id) => {
      const session = sessions.get(sceneSync.sessionKeyOf(id) ?? "");
      return session ? [[id, statusLine(session)]] : [];
    }),
  );

  const overview = overviewOf(
    { sessions, machines, folders, overrides, offline: offlineIds },
    now,
  );
  const departures = todaysDepartures([...sessions.values()], now).filter(
    (session) => overview.tree.companyOf(session)?.companyKey === companyKey,
  );

  return (
    <div className="flex h-full w-full flex-col">
      <CompanyStrip
        macs={overview.macs}
        selectedKey={companyKey}
        onSelect={selectCompany}
        onOpenDrawer={openDrawer}
        drawerButtonRef={drawerButtonRef}
      />
      <div
        ref={containerRef}
        className="relative min-h-0 w-full flex-1 overflow-hidden"
      >
        <OfficeCanvas
          officeState={officeState}
          onClick={(id) => setSelectedKey(sceneSync.sessionKeyOf(id) ?? null)}
          zoom={zoom}
          onZoomChange={(next) => {
            userZoomed.current = true;
            setZoom(next);
          }}
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
              roomCounts={() => sceneSync.roomCounts()}
            />
            <ToolOverlay
              officeState={officeState}
              agents={agentIds}
              activity={activity}
              containerRef={containerRef}
              zoom={zoom}
              panRef={panRef}
            />
          </>
        )}
        <ConnectionStatus
          lastUpdatedAt={lastUpdatedAt}
          connectionLost={connectionLost}
          now={now.getTime()}
        />
        <WentHomeList
          departures={departures}
          folded={isMobile}
          onSelect={(session) => setSelectedKey(sessionKey(session))}
        />
        {drawerOpen && (
          <CompanyDrawer
            overview={overview}
            selectedKey={companyKey}
            sheet={isMobile}
            onSelect={(key) => {
              selectCompany(key);
              closeDrawer();
            }}
            error={switchError}
            onSetCompanyMode={(machineId, path, mode) =>
              void setCompanyMode(machineId, path, mode)
            }
            onClose={closeDrawer}
          />
        )}
        <DetailsPanel
          session={selectedKey ? (sessions.get(selectedKey) ?? null) : null}
          offlineMachineIds={offlineIds}
          sheet={isMobile}
          onClose={() => {
            setSelectedKey(null);
            officeState.selectedAgentId = null;
          }}
        />
      </div>
      {isMobile && (
        <MobileAgentBar
          cards={cards}
          selectedId={officeState.selectedAgentId}
          onSelect={(id) => {
            officeState.selectAndFollow(id);
            setSelectedKey(sceneSync.sessionKeyOf(id) ?? null);
          }}
        />
      )}
    </div>
  );
}

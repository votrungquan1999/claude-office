"use client";

import { useEffect, useRef, useState } from "react";
import { loadOfficeAssets } from "@/office/assetLoader";
import { OfficeCanvas } from "@/office/components/OfficeCanvas";
import {
  StackedRooms,
  type StackedTile,
} from "@/office/components/StackedRooms";
import { ToolOverlay } from "@/office/components/ToolOverlay";
import { OfficeState } from "@/office/engine/officeState";
import { fitZoom } from "@/office/fitZoom";
import { useHasMouse } from "@/office/hooks/useHasMouse";
import { useIsMobile } from "@/office/hooks/useIsMobile";
import { useIsPhone } from "@/office/hooks/useIsPhone";
import {
  dismissClosesWindow,
  macBlock,
  offlineMachineIds,
} from "@/office/offline";
import { ROOM_OF_STATE } from "@/office/rooms";
import { createSceneSync, lookOf } from "@/office/sceneSync";
import { installTestHooks } from "@/office/testHooks";
import { dayStartOf, todaysDepartures } from "@/office/wentHome";
import { employeeName } from "@/shared/employee-name";
import type { FolderDto } from "@/shared/folders";
import { resolveSelection } from "@/shared/overview";
import {
  type ChangesResponse,
  type MachineDto,
  type SessionDto,
  sessionKey,
} from "@/shared/session";
import { SHOW_ALL, type TagFilterSelection } from "@/shared/tag-filter";
import { CompanyDrawer } from "./CompanyDrawer";
import { CompanyStrip } from "./CompanyStrip";
import { ConnectionStatus } from "./ConnectionStatus";
import { readCollapsedMacs, storeCollapsedMacs } from "./collapsedMacs";
import { postCompanyMode } from "./companyMode";
import { DetailsPanel, type OrderClickState } from "./DetailsPanel";
import { postDismiss } from "./dismiss";
import { postDisplayName } from "./displayName";
import { postEmployeeName, settleEmployeeNames } from "./employeeName";
import { HireDialog, type HireMac } from "./HireDialog";
import { companyRowsOf } from "./list/companyRows";
import { ListPanel } from "./list/ListPanel";
import { settleRanks } from "./list/pendingRanks";
import { useListModel } from "./list/useListModel";
import { useReviewMoves } from "./list/useReviewMoves";
import { useRowMoves } from "./list/useRowMoves";
import { useSeenRows } from "./list/useSeenRows";
import {
  type OfficeData,
  overviewOf,
  shownSessions,
  type TagPick,
  tagFilterOf,
} from "./officeData";
import {
  acceptName,
  type ModeOverrides,
  mergeSessions,
  type NameOverrides,
  overrideKey,
  refuseName,
  type SessionMap,
  settleNames,
  settleOverrides,
} from "./officeStore";
import { PhoneBottomBar } from "./PhoneBottomBar";
import { RoomSigns } from "./RoomSigns";
import { settleReviewMoves } from "./reviewSeen";
import { TagFilter } from "./TagFilter";
import { useOfficeChanges } from "./useOfficeChanges";
import { useTabTitle } from "./useTabTitle";
import { WentHomeDrawer, type WentHomeRow } from "./WentHomeDrawer";
import { postWake } from "./wake";

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

const STATUS_LINES = {
  working: "Working",
  thinking: "Thinking",
  needsPermission: "Needs permission",
  waitingForYou: "Waiting for you",
  review: "Review",
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
  const [names, setNames] = useState<NameOverrides>(new Map());
  const [switchError, setSwitchError] = useState<string | null>(null);
  // The company whose last rename was refused; its own state so a switch error never wipes it.
  const [renameError, setRenameError] = useState<{
    machineId: string;
    path: string;
    message: string;
  } | null>(null);
  const [companyKey, setCompanyKey] = useState<string | null>(null);
  const [tagPick, setTagPick] = useState<TagPick>({
    companyKey: null,
    selection: SHOW_ALL,
  });
  // Read at first render (the view loads client-only) so a reload never flashes the folded Macs open.
  const [collapsedMacs, setCollapsedMacs] =
    useState<ReadonlySet<string>>(readCollapsedMacs);
  // One right-hand panel at a time, so switching is a single state change.
  const [rightPanel, setRightPanel] = useState<"companies" | "wentHome" | null>(
    null,
  );
  const drawerOpen = rightPanel === "companies";
  const wentHomeOpen = rightPanel === "wentHome";
  const [hireOpen, setHireOpen] = useState(false);
  const wentHomeButtonRef = useRef<HTMLButtonElement>(null);
  // The phone's bar is unmounted while a sheet is open, so focus waits for it to come back.
  const focusWentHomeOnMount = useRef(false);
  const phoneWentHomeRef = (button: HTMLButtonElement | null) => {
    wentHomeButtonRef.current = button;
    if (button && focusWentHomeOnMount.current) {
      focusWentHomeOnMount.current = false;
      button.focus();
    }
  };
  // Wake orders by session, so selecting another employee and back shows the same pending order and outcome.
  const [wakes, setWakes] = useState<Map<string, OrderClickState>>(new Map());
  // Dismiss orders by session, kept apart from wakes for the same reason.
  const [dismisses, setDismisses] = useState<Map<string, OrderClickState>>(
    new Map(),
  );
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => new Date());
  // How far the server's clock is ahead of this browser's, from the latest answer.
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const seen = useSeenRows();
  // The employee last picked in the office; the list scrolls its row into view.
  const [reveal, setReveal] = useState<{ key: string; token: number } | null>(
    null,
  );
  // A details card opened while the went-home drawer was open sits above it.
  const [cardOverWentHome, setCardOverWentHome] = useState(false);
  const [zoom, setZoom] = useState(1);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const containerRef = useRef<HTMLDivElement>(null);
  // Once the owner zooms by hand, resizing no longer re-fits the office.
  const userZoomed = useRef(false);
  const isMobile = useIsMobile();
  const isPhone = useIsPhone();
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const hasMouse = useHasMouse();
  const dataRef = useRef<OfficeData>({
    sessions: new Map(),
    machines: [],
    folders: [],
    overrides: new Map(),
    names: new Map(),
    reviewMoves: new Map(),
    employeeNames: new Map(),
    ranks: new Map(),
    offline: new Set(),
  });
  // The poll reads refs only, so the picked company lives in one too.
  const companyRef = useRef<string | null>(null);
  const tagPickRef = useRef<TagPick>({ companyKey: null, selection: SHOW_ALL });
  // Numbers each rename request, so an answer to an old one never touches a newer name.
  const renameTokenRef = useRef(0);
  // The browser's own midnight decides which departures count as today.
  const [dayStart] = useState(() => dayStartOf(new Date()).toISOString());

  /**
   * Forgets any tag pick and shows everyone in a company.
   * @param key - The company the reset pick belongs to.
   */
  const resetTagPick = (key: string | null) => {
    const pick = { companyKey: key, selection: SHOW_ALL };
    tagPickRef.current = pick;
    setTagPick(pick);
  };

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
    const shown = shownSessions(data);
    const sessionList = [...shown.values()];
    const filter = tagFilterOf(
      shown,
      overview.tree.companyOf,
      key,
      tagPickRef.current,
    );
    // The tag filter narrows who stands in the office; a session that went home is never there anyway.
    const only = new Set(
      sessionList
        .filter(
          (s) =>
            overview.tree.companyOf(s)?.companyKey === key &&
            (s.state === "wentHome" || filter.matches(s)),
        )
        .map(sessionKey),
    );
    sceneSync.apply(sessionList, {
      firstLoad: options.sitDown,
      offlineMachineIds: data.offline,
      only,
      companyOf: overview.tree.companyOf,
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
    const shown = shownSessions(data);
    setSessions(shown);
    setOfflineIds(data.offline);
    setMachines(data.machines);
    setFolders(data.folders);
    setOverrides(data.overrides);
    setNames(data.names);
    // Resolved here from the merged data, so the first paint already shows the right company.
    const overview = overviewOf(data, new Date());
    // A pick read back from storage holds only while its company is active; one made in this page holds while it exists.
    const picked = resolveSelection(
      overview,
      companyRef.current ?? readStoredCompany(),
      { restored: companyRef.current === null },
    );
    const changed = picked !== companyRef.current;
    // A pick that stopped applying (tag gone, other company) is dropped so it cannot return later.
    const inForce = tagFilterOf(
      shown,
      overview.tree.companyOf,
      picked,
      tagPickRef.current,
    ).selection;
    const pick = tagPickRef.current.selection;
    if (inForce.kind !== pick.kind || inForce.key !== pick.key) {
      resetTagPick(picked);
    }
    companyRef.current = picked;
    setCompanyKey(picked);
    showCompany(data, picked, { sitDown: sitDown || changed });
  };

  /** Folds one answer into the sessions and the scene. */
  const onAnswer = (
    answer: ChangesResponse,
    firstLoad: boolean,
    poll: number,
  ) => {
    setServerOffsetMs(Date.parse(answer.serverNow) - Date.now());
    const sessions = mergeSessions(
      firstLoad ? new Map() : dataRef.current.sessions,
      answer.sessions,
    );
    if (firstLoad) seen.load([...sessions.keys()]);
    commit(
      {
        sessions,
        machines: answer.machines,
        folders: answer.folders,
        // A switch stays in force until an answer agrees, so a poll already in flight cannot flip it back.
        overrides: settleOverrides(dataRef.current.overrides, answer.folders),
        names: settleNames(dataRef.current.names, answer.folders, poll),
        // A move stays in force until an answer shows something other than the Review the owner saw.
        reviewMoves: settleReviewMoves(dataRef.current.reviewMoves, sessions),
        // A name stays in force until an answer shows it, so a poll already in flight cannot put the old one back.
        employeeNames: settleEmployeeNames(
          dataRef.current.employeeNames,
          sessions,
          poll,
        ),
        // A place stays in force until an answer shows it or a later change of the row, so a poll already in flight cannot put the row back.
        ranks: settleRanks(dataRef.current.ranks, sessions),
        // Judged against the server's clock: the phone's may be minutes off.
        offline: offlineMachineIds(answer.machines, answer.serverNow, [
          ...[...sessions.values()].map((session) => session.machineId),
          ...answer.folders.map((folder) => folder.machineId),
        ]),
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

  /** Names a company at once and sends it; a refused request puts the old name back. */
  const renameCompany = async (
    machineId: string,
    path: string,
    displayName: string | null,
  ) => {
    const key = overrideKey(machineId, path);
    const token = ++renameTokenRef.current;
    setRenameError(null);
    commit(
      {
        ...dataRef.current,
        names: new Map(dataRef.current.names).set(key, {
          name: displayName,
          token,
          storedAfterPoll: null,
        }),
      },
      false,
    );
    const sent = await postDisplayName({ machineId, path, displayName });
    if (sent) {
      // The server holds it now; an answer to a poll started from here on is the truth, whatever name it shows.
      commit(
        {
          ...dataRef.current,
          names: acceptName(
            dataRef.current.names,
            key,
            token,
            lastStartedPoll(),
          ),
        },
        false,
      );
      return;
    }
    // A later rename of the same company owns the pending name now, so this failure leaves it alone.
    const reverted = refuseName(dataRef.current.names, key, token);
    if (reverted === dataRef.current.names) return;
    commit({ ...dataRef.current, names: reverted }, false);
    setRenameError({
      machineId,
      path,
      message: "Could not rename. Try again.",
    });
  };

  const { moveReviewsToIdle, refused } = useReviewMoves({
    getSessions: () => dataRef.current.sessions,
    getMoves: () => dataRef.current.reviewMoves,
    setMoves: (reviewMoves) =>
      commit({ ...dataRef.current, reviewMoves }, false),
    serverOffsetMs,
  });
  const moveToIdle = (key: string) => moveReviewsToIdle([key]);

  /** Shows the owner's name for an employee at once and sends it; a refused request puts the old name back. */
  const renameEmployee = async (key: string, name: string) => {
    const session = dataRef.current.sessions.get(key);
    if (!session) return false;
    const pending = { name, storedAfterPoll: null };
    commit(
      {
        ...dataRef.current,
        employeeNames: new Map(dataRef.current.employeeNames).set(key, pending),
      },
      false,
    );
    const sent = await postEmployeeName({
      machineId: session.machineId,
      sessionId: session.sessionId,
      name,
    });
    if (sent) {
      // The server holds it now; an answer to a poll started from here on is the truth, whatever name it shows.
      if (dataRef.current.employeeNames.get(key) === pending)
        commit(
          {
            ...dataRef.current,
            employeeNames: new Map(dataRef.current.employeeNames).set(key, {
              name,
              storedAfterPoll: lastStartedPoll(),
            }),
          },
          false,
        );
      return true;
    }
    // Only this rename's own pending name is taken back
    if (dataRef.current.employeeNames.get(key) === pending) {
      const reverted = new Map(dataRef.current.employeeNames);
      reverted.delete(key);
      commit({ ...dataRef.current, employeeNames: reverted }, false);
    }
    return false;
  };

  const { moveRow, moveToEnd, rankError, placeError } = useRowMoves({
    getRanks: () => dataRef.current.ranks,
    setRanks: (ranks) => commit({ ...dataRef.current, ranks }, false),
    serverOffsetMs,
    viewedRows: () =>
      companyRowsOf(dataRef.current, companyRef.current, tagPickRef.current),
  });

  /** Opens the company drawer; a details panel left open would sit under it, so it closes. */
  const openDrawer = () => {
    setSwitchError(null);
    setRenameError(null);
    setSelectedKey(null);
    officeState.selectedAgentId = null;
    setRightPanel("companies");
  };

  /** Closes the drawer and puts focus back on the button that opened it. */
  const closeDrawer = () => {
    setRightPanel(null);
    drawerButtonRef.current?.focus();
  };
  const toggleDrawer = () => (drawerOpen ? closeDrawer() : openDrawer());

  /** Folds a Mac's group in the company bar, or opens it again. */
  const toggleMac = (machineId: string) => {
    const next = new Set(collapsedMacs);
    if (!next.delete(machineId)) next.add(machineId);
    setCollapsedMacs(next);
    storeCollapsedMacs(next);
  };

  /** Narrows the office to a tag at once. */
  const selectTag = (selection: TagFilterSelection) => {
    const pick = { companyKey: companyRef.current, selection };
    tagPickRef.current = pick;
    setTagPick(pick);
    showCompany(dataRef.current, companyRef.current, { sitDown: true });
  };

  /** Switches the office to another company at once. */
  const selectCompany = (key: string) => {
    // Pressing the viewed company is not a switch; a double-click to rename must keep the filter.
    if (key === companyRef.current) return;
    // A refused rename is old news once the owner has moved on.
    setRenameError(null);
    companyRef.current = key;
    setCompanyKey(key);
    resetTagPick(key);
    storeCompany(key);
    showCompany(dataRef.current, key, { sitDown: true });
  };

  // Employees need the layout's seats, so polling starts only after the assets.
  const { lastUpdatedAt, connectionLost, lastStartedPoll } = useOfficeChanges({
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

  const tiles: StackedTile[] = agentIds.flatMap((id) => {
    const key = sceneSync.sessionKeyOf(id) ?? "";
    const session = sessions.get(key);
    const room = session && ROOM_OF_STATE[session.state];
    if (!session || !room) return [];
    return [
      {
        key,
        room,
        task: employeeName(session),
        ...lookOf(key),
        state: session.state,
        offline: offlineIds.has(session.machineId),
        since: Date.parse(session.stateSince ?? session.startedAt),
      },
    ];
  });

  const activity = Object.fromEntries(
    agentIds.flatMap((id) => {
      const session = sessions.get(sceneSync.sessionKeyOf(id) ?? "");
      return session ? [[id, statusLine(session)]] : [];
    }),
  );

  // `sessions` already has the pending moves laid over
  const overview = overviewOf(
    {
      sessions,
      machines,
      folders,
      overrides,
      names,
      reviewMoves: new Map(),
      employeeNames: new Map(),
      ranks: new Map(),
      offline: offlineIds,
    },
    now,
  );
  const tagFilterView = tagFilterOf(
    sessions,
    overview.tree.companyOf,
    companyKey,
    tagPick,
  );
  const viewedCompany = overview.macs
    .flatMap((mac) => mac.companies)
    .find((entry) => entry.company.key === companyKey)?.company;
  // Judged on the server's clock, like the offline badge.
  const serverNowIso = new Date(now.getTime() + serverOffsetMs).toISOString();
  const hireMacs: HireMac[] = machines.map((machine) => ({
    machineId: machine.machineId,
    machineName: machine.machineName,
    block: macBlock(machine, serverNowIso),
  }));
  const hireButton = (
    <button
      type="button"
      data-testid="hire-button"
      onClick={() => setHireOpen(true)}
      className="absolute right-2 bottom-2 z-30 flex min-h-[44px] min-w-[44px] items-center gap-6 border-2 border-border bg-btn-bg px-12 text-sm font-bold hover:bg-btn-hover"
    >
      <span aria-hidden="true">+</span>
      Hire
    </button>
  );
  const selectedSession = selectedKey
    ? (sessions.get(selectedKey) ?? null)
    : null;
  const wakeSelected = async () => {
    if (!selectedSession) return;
    const key = sessionKey(selectedSession);
    setWakes((current) => new Map(current).set(key, { sending: true }));
    const result = await postWake({
      machineId: selectedSession.machineId,
      sessionId: selectedSession.sessionId,
    });
    setWakes((current) =>
      new Map(current).set(
        key,
        result.ok ? { orderId: result.order.orderId } : { error: result.error },
      ),
    );
  };
  const dismissSelected = async (endRunning: boolean) => {
    if (!selectedSession) return;
    const key = sessionKey(selectedSession);
    setDismisses((current) => new Map(current).set(key, { sending: true }));
    const result = await postDismiss({
      machineId: selectedSession.machineId,
      sessionId: selectedSession.sessionId,
      ...(endRunning && { endRunning }),
    });
    setDismisses((current) =>
      new Map(current).set(
        key,
        result.ok ? { orderId: result.order.orderId } : { error: result.error },
      ),
    );
  };
  const { everyone, selectedPlace, needsYou, listFold } = useListModel({
    sessions,
    overview,
    companyKey,
    matches: tagFilterView.matches,
    selectedKey,
    offlineIds,
    // Sessions come with the first answer, not with the assets
    loaded: loaded && lastUpdatedAt !== null,
  });
  useTabTitle(needsYou.total);
  /**
   * Opens the original of a Needs you copy, switching company first when it lives elsewhere.
   * @param key - The employee to open.
   * @param homeKey - The company the copy belongs to.
   */
  const selectNeedsYouRow = (key: string, homeKey: string | null) => {
    if (homeKey && homeKey !== companyRef.current) selectCompany(homeKey);
    else if (
      !sessions.has(key) ||
      !tagFilterView.matches(sessions.get(key) as SessionDto)
    ) {
      // A repo filter must never hide the employee the owner just asked for.
      resetTagPick(companyRef.current);
      showCompany(dataRef.current, companyRef.current, { sitDown: false });
    }
    selectEmployee(key, "list");
  };
  const departures = todaysDepartures([...sessions.values()], now).filter(
    (session) => overview.tree.companyOf(session)?.companyKey === companyKey,
  );

  const wentHomeRows: WentHomeRow[] = loaded
    ? departures.map((session) => {
        const key = sessionKey(session);
        const placed = overview.tree.companyOf(session);
        return {
          key,
          ...lookOf(key),
          task: employeeName(session),
          where: `${session.machineName} / ${placed?.companyName}${placed?.project ? `/${placed.project}` : ""}`,
          time: new Date(session.endedAt ?? "").toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
      })
    : [];
  // A card opened while the went-home drawer is open is the newer overlay, however it was opened.
  const openDetails = (key: string | null) => {
    if (key !== null) seen.open(key);
    setSelectedKey(key);
    setCardOverWentHome(wentHomeOpen && key !== null);
  };
  /**
   * Opens an employee's card and lights it up in the office; the office click already set its own outline.
   * @param key - The session to open, or null for none.
   * @param source - Where the pick came from; a list pick also moves the camera to the employee.
   */
  const selectEmployee = (key: string | null, source: "list" | "office") => {
    setReveal((last) =>
      source === "office" && key !== null
        ? { key, token: (last?.token ?? 0) + 1 }
        : null,
    );
    if (source === "list") {
      const id = key === null ? undefined : sceneSync.agentIdOf(key);
      // A session with no one in the office (it went home) must not leave the earlier employee outlined.
      if (id === undefined) officeState.selectedAgentId = null;
      else officeState.selectAndFollow(id);
    }
    openDetails(key);
  };
  const closeDetails = () => {
    setSelectedKey(null);
    officeState.selectedAgentId = null;
    setCardOverWentHome(false);
  };
  const openWentHome = () => {
    setCardOverWentHome(false);
    setRightPanel("wentHome");
  };
  const closeWentHome = () => {
    setCardOverWentHome(false);
    setRightPanel(null);
    focusWentHomeOnMount.current = true;
  };

  return (
    <div className="flex h-full w-full flex-col">
      <CompanyStrip
        macs={overview.macs}
        selectedKey={companyKey}
        onSelect={selectCompany}
        onOpenDrawer={toggleDrawer}
        drawerButtonRef={drawerButtonRef}
        collapsedMacs={collapsedMacs}
        onToggleMac={toggleMac}
        onRename={(machineId, path, name) =>
          void renameCompany(machineId, path, name)
        }
        renamable={hasMouse}
        phone={isPhone}
      />
      <div className="flex min-h-0 w-full flex-1">
        <div
          ref={containerRef}
          className="relative h-full min-w-0 flex-1 overflow-hidden"
        >
          {isPhone ? (
            <div className="flex h-full flex-col">
              {/* Its own row above the scrolling rooms, so neither the pill nor the status covers a room header. */}
              <div className="flex shrink-0 items-start justify-between gap-8 px-10 pt-4">
                <TagFilter
                  view={tagFilterView}
                  onSelect={selectTag}
                  sheet
                  onOpenChange={setTagSheetOpen}
                  covered={rightPanel !== null || selectedSession !== null}
                />
                <div className="ml-auto shrink-0">
                  <ConnectionStatus
                    lastUpdatedAt={lastUpdatedAt}
                    connectionLost={connectionLost}
                    now={now.getTime()}
                    inFlow
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {loaded && (
                  <StackedRooms
                    tiles={tiles}
                    selectedKey={selectedKey}
                    onSelect={openDetails}
                  />
                )}
              </div>
            </div>
          ) : (
            <>
              <OfficeCanvas
                officeState={officeState}
                onClick={(id) =>
                  selectEmployee(sceneSync.sessionKeyOf(id) ?? null, "office")
                }
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
            </>
          )}
          {/* Above the details card (z-60) so the pill stays pressable while a card is open. */}
          {!isPhone && (
            <div className="absolute top-2 left-2 z-[65]">
              <TagFilter
                view={tagFilterView}
                onSelect={selectTag}
                sheet={isMobile}
                covered={rightPanel !== null || selectedSession !== null}
              />
            </div>
          )}
          {!isPhone && (
            <ConnectionStatus
              lastUpdatedAt={lastUpdatedAt}
              connectionLost={connectionLost}
              now={now.getTime()}
              besideDrawer={drawerOpen && !isMobile}
            />
          )}
          {/* Over the office below the bar, so it takes no layout height; the drawer shows its own copy in the row. */}
          {renameError && !drawerOpen && (
            <p
              role="alert"
              data-testid="rename-error"
              className="absolute top-2 left-1/2 z-[66] -translate-x-1/2 border-2 border-warning bg-bg px-10 py-6 text-xs font-bold text-warning"
            >
              {renameError.message}
            </p>
          )}
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
              renameError={renameError}
              onSetCompanyMode={(machineId, path, mode) =>
                void setCompanyMode(machineId, path, mode)
              }
              onRename={(machineId, path, name) =>
                void renameCompany(machineId, path, name)
              }
              onClose={closeDrawer}
            />
          )}
          {/* Not on a phone (the bottom bar has its own Hire); hidden while a right panel or a details sheet is open, so it never sits over or beside them. */}
          {!isPhone &&
            !drawerOpen &&
            !(isMobile && selectedSession) &&
            hireButton}
          {hireOpen && (
            <HireDialog
              macs={hireMacs}
              folders={folders}
              initialMachineId={viewedCompany?.machineId ?? null}
              initialFolder={viewedCompany?.path ?? null}
              onClose={() => setHireOpen(false)}
            />
          )}
          {wentHomeOpen && (
            <WentHomeDrawer
              companyName={viewedCompany?.name ?? ""}
              rows={wentHomeRows}
              detailsOpen={cardOverWentHome && selectedKey !== null}
              onSelect={openDetails}
              onCloseDetails={closeDetails}
              onClose={closeWentHome}
            />
          )}
          <DetailsPanel
            raised={wentHomeOpen}
            session={selectedSession}
            serverOffsetMs={serverOffsetMs}
            project={
              selectedSession
                ? overview.tree.companyOf(selectedSession)?.project
                : undefined
            }
            tagLabels={tagFilterView.labels}
            offlineMachineIds={offlineIds}
            folders={folders}
            macBlock={
              selectedSession
                ? macBlock(
                    machines.find(
                      (machine) =>
                        machine.machineId === selectedSession.machineId,
                    ),
                    serverNowIso,
                  )
                : undefined
            }
            wake={selectedKey ? wakes.get(selectedKey) : undefined}
            onWake={() => void wakeSelected()}
            dismissClosesWindow={dismissClosesWindow(
              machines.find(
                (machine) => machine.machineId === selectedSession?.machineId,
              )?.agentVersion,
            )}
            dismiss={selectedKey ? dismisses.get(selectedKey) : undefined}
            onDismiss={(endRunning) => void dismissSelected(endRunning)}
            onRename={(name) =>
              selectedKey
                ? renameEmployee(selectedKey, name)
                : Promise.resolve(false)
            }
            onMoveToIdle={() =>
              selectedKey ? moveToIdle(selectedKey) : undefined
            }
            moveToIdleError={
              selectedKey && !refused.all && refused.keys.has(selectedKey)
                ? "Could not move to Idle. Try again."
                : undefined
            }
            place={selectedPlace ?? undefined}
            placeError={placeError}
            onMoveToTop={() =>
              selectedKey && void moveToEnd(selectedKey, "top")
            }
            onMoveToBottom={() =>
              selectedKey && void moveToEnd(selectedKey, "bottom")
            }
            sheet={isMobile}
            onClose={closeDetails}
          />
        </div>
        {!isPhone && (
          <ListPanel
            fold={listFold}
            needsYou={{
              needsYou,
              viewedCompanyKey: companyKey,
              onSelect: selectNeedsYouRow,
              onMoveAllToIdle: (items) =>
                void moveReviewsToIdle(items.map(sessionKey), true),
              moveAllError: refused.all
                ? "Could not move to Idle. Try again."
                : undefined,
            }}
            companyName={viewedCompany?.name ?? ""}
            employees={everyone}
            seenKeys={seen.seenKeys}
            selectedKey={selectedKey}
            reveal={reveal}
            departures={wentHomeRows}
            onSelectDeparture={(key) => selectEmployee(key, "list")}
            offlineMachineIds={offlineIds}
            tagLabels={tagFilterView.labels}
            serverOffsetMs={serverOffsetMs}
            onSelect={(key) => selectEmployee(key, "list")}
            canDrag={hasMouse}
            onMove={(key, overKey) => void moveRow(key, overKey)}
            moveError={rankError}
            onDragHover={(key) => {
              officeState.hoveredAgentId =
                key === null ? null : (sceneSync.agentIdOf(key) ?? null);
            }}
            onMoveToIdle={(key) => void moveToIdle(key)}
            onRename={renameEmployee}
          />
        )}
      </div>
      {isPhone &&
        !drawerOpen &&
        !wentHomeOpen &&
        !selectedSession &&
        !tagSheetOpen && (
          <PhoneBottomBar
            wentHomeCount={departures.length}
            onWentHome={openWentHome}
            wentHomeRef={phoneWentHomeRef}
            onHire={() => setHireOpen(true)}
          />
        )}
    </div>
  );
}

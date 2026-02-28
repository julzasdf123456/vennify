import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io, Socket } from "socket.io-client";
import { Canvas } from "./components/Canvas";
import { ItemList } from "./components/ItemList";
import { LoginPage } from "./components/LoginPage";
import { InviteModal } from "./components/InviteModal";
import { NotificationsPanel } from "./components/NotificationsPanel";
import { ItemModal } from "./components/ItemModal";
import { ModuleModal } from "./components/ModuleModal";
import { ListView } from "./components/ListView";
import { KanbanView } from "./components/KanbanView";
import { CalendarView } from "./components/CalendarView";
import { MilestonesView } from "./components/MilestonesView";
import { ModulesView } from "./components/ModulesView";
import {
  API_URL,
  acceptInvite,
  createWorkspace,
  fetchMe,
  fetchInvites,
  fetchNotifications,
  fetchProjectState,
  fetchWorkspaces,
  fetchWorkspaceMembers,
  fetchListViewPreference,
  createItem,
  updateItem,
  deleteItem,
  inviteToWorkspace,
  logout,
  saveProjectState,
  saveListViewPreference,
  updateWorkspace,
  markNotificationsRead,
  WorkspaceInvite,
  WorkspaceSummary,
  WorkspaceMember,
  UserNotification,
} from "./lib/api";
import { computeMemberships, isInsideCircle } from "./lib/geometry";
import { ItemWithPosition, ModuleCircle } from "./types";

const MODULE_COLORS = ["#5d7aff", "#ff6f59", "#3ddc97", "#f7c948"];
const PROJECT_SLUG = "default";
const WORKSPACE_STORAGE_KEY = "vennify.activeWorkspaceId";
const LIST_COLUMNS_KEY = "vennify.listColumns";
const THEME_STORAGE_KEY = "vennify.theme";
const getWorkspaceStorageKey = (userId: string) =>
  `${WORKSPACE_STORAGE_KEY}.${userId}`;
const getListColumnsKey = (userId: string, workspaceId: string) =>
  `${LIST_COLUMNS_KEY}.${userId}.${workspaceId}`;

const nextZIndex = (values: number[]) =>
  values.length === 0 ? 1 : Math.max(...values) + 1;

const STATUS_ORDER = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "REVIEW",
  "ROADBLOCKED",
  "DONE",
] as const;

const PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const DEFAULT_LIST_COLUMNS = [
  "title",
  "status",
  "assignee",
  "startDate",
  "dueDate",
  "priority",
] as const;

const HISTORY_LIMIT = 50;

type VennSnapshot = {
  modules: ModuleCircle[];
  items: ItemWithPosition[];
};

const cloneModules = (modules: ModuleCircle[]) =>
  modules.map((module) => ({ ...module }));

const cloneItems = (items: ItemWithPosition[]) =>
  items.map((item) => ({
    ...item,
    tags: [...item.tags],
    assigneeIds: [...item.assigneeIds],
    customFields: item.customFields.map((field) => ({ ...field })),
    relatedItemIds: [...item.relatedItemIds],
    position: { ...item.position },
  }));

const makeSnapshot = (
  modules: ModuleCircle[],
  items: ItemWithPosition[]
): VennSnapshot => ({
  modules: cloneModules(modules),
  items: cloneItems(items),
});

const App: React.FC = () => {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  });
  const [modules, setModules] = useState<ModuleCircle[]>([]);
  const [items, setItems] = useState<ItemWithPosition[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    "loading" | "idle" | "saving" | "error"
  >("loading");
  const [user, setUser] = useState<{
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeWorkspaceRole, setActiveWorkspaceRole] = useState<string | null>(
    null
  );
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [projectReady, setProjectReady] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const skipNextSaveRef = useRef(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [editingWorkspace, setEditingWorkspace] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const workspaceInputRef = useRef<HTMLInputElement | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [moduleModalOpen, setModuleModalOpen] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [showFullItemTitles, setShowFullItemTitles] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<
    "venn" | "modules" | "list" | "kanban" | "calendar" | "milestones"
  >("venn");
  const [listColumns, setListColumns] = useState<string[]>(
    [...DEFAULT_LIST_COLUMNS]
  );
  const listPrefTimerRef = useRef<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const clientIdRef = useRef(crypto.randomUUID());
  const suppressSyncRef = useRef(false);
  const emitTimerRef = useRef<number | null>(null);
  const pendingEmitRef = useRef<{
    modules: ModuleCircle[];
    items: ItemWithPosition[];
  } | null>(null);
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const modulesRef = useRef(modules);
  const itemsRef = useRef(items);
  const historyRef = useRef<{ past: VennSnapshot[]; future: VennSnapshot[] }>({
    past: [],
    future: [],
  });
  const historyDragRef = useRef({ active: false, recorded: false });
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const updateHistoryState = () => {
    setHistoryState({
      canUndo: historyRef.current.past.length > 0,
      canRedo: historyRef.current.future.length > 0,
    });
  };

  const pushToast = useCallback((message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const pushHistorySnapshot = () => {
    historyRef.current.past.push(
      makeSnapshot(modulesRef.current, itemsRef.current)
    );
    if (historyRef.current.past.length > HISTORY_LIMIT) {
      historyRef.current.past.shift();
    }
    historyRef.current.future = [];
    updateHistoryState();
  };

  const recordHistoryIfNeeded = () => {
    if (historyDragRef.current.active) {
      if (historyDragRef.current.recorded) return;
      historyDragRef.current.recorded = true;
    }
    pushHistorySnapshot();
  };

  const beginHistoryGesture = () => {
    historyDragRef.current.active = true;
    historyDragRef.current.recorded = false;
  };

  const endHistoryGesture = () => {
    historyDragRef.current.active = false;
    historyDragRef.current.recorded = false;
  };

  const resetHistory = (nextModules: ModuleCircle[], nextItems: ItemWithPosition[]) => {
    historyRef.current = { past: [], future: [] };
    historyDragRef.current = { active: false, recorded: false };
    setHistoryState({ canUndo: false, canRedo: false });
    modulesRef.current = nextModules;
    itemsRef.current = nextItems;
  };

  const emitCanvasUpdate = (
    nextModules: ModuleCircle[],
    nextItems: ItemWithPosition[]
  ) => {
    const socket = socketRef.current;
    if (!socket || !activeWorkspaceIdRef.current) return;
    pendingEmitRef.current = { modules: nextModules, items: nextItems };
    if (emitTimerRef.current) return;
    emitTimerRef.current = window.setTimeout(() => {
      const payload = pendingEmitRef.current;
      pendingEmitRef.current = null;
      emitTimerRef.current = null;
      if (!payload) return;
      socket.emit("canvas:update", {
        workspaceId: activeWorkspaceIdRef.current,
        slug: PROJECT_SLUG,
        modules: payload.modules,
        items: payload.items,
        clientId: clientIdRef.current,
      });
    }, 80);
  };

  const emitItemUpdate = (item: ItemWithPosition) => {
    const socket = socketRef.current;
    if (!socket || !activeWorkspaceIdRef.current) return;
    socket.emit("item:update", {
      workspaceId: activeWorkspaceIdRef.current,
      slug: PROJECT_SLUG,
      item,
      clientId: clientIdRef.current,
    });
  };

  const emitItemDelete = (itemId: string) => {
    const socket = socketRef.current;
    if (!socket || !activeWorkspaceIdRef.current) return;
    socket.emit("item:delete", {
      workspaceId: activeWorkspaceIdRef.current,
      slug: PROJECT_SLUG,
      itemId,
      clientId: clientIdRef.current,
    });
  };

  const getContainmentDepth = (
    point: { x: number; y: number },
    module: ModuleCircle
  ) => {
    const dx = Math.abs(point.x - module.x);
    const dy = Math.abs(point.y - module.y);
    const shape = module.shape ?? "solid";
    if (shape === "square") {
      return Math.min(module.radius - dx, module.radius - dy);
    }
    if (shape === "diamond") {
      return module.radius - (dx + dy);
    }
    return module.radius - Math.hypot(dx, dy);
  };

  const pickOwnerModuleId = (
    item: ItemWithPosition,
    modules: ModuleCircle[]
  ) => {
    if (modules.length === 0) return null;
    const inside = modules.filter((module) =>
      isInsideCircle(item.position, module)
    );
    if (inside.length === 0) return null;
    if (item.ownerModuleId) {
      const current = inside.find((module) => module.id === item.ownerModuleId);
      if (current) return current.id;
    }
    let best: ModuleCircle | null = null;
    let bestScore = -Infinity;
    let bestDepth = -Infinity;
    inside.forEach((module) => {
      const depth = getContainmentDepth(item.position, module);
      const score = depth / Math.max(module.radius, 1);
      if (
        score > bestScore ||
        (score === bestScore &&
          (depth > bestDepth ||
            (depth === bestDepth &&
              (best ? module.zIndex > best.zIndex : true))))
      ) {
        best = module;
        bestScore = score;
        bestDepth = depth;
      }
    });
    return best?.id ?? null;
  };

  const assignOwnerModules = (
    nextItems: ItemWithPosition[],
    nextModules: ModuleCircle[]
  ) => {
    let changed = false;
    const updated = nextItems.map((item) => {
      const nextOwner = pickOwnerModuleId(item, nextModules);
      const currentOwner = item.ownerModuleId ?? null;
      if (nextOwner === currentOwner) {
        return item;
      }
      changed = true;
      return { ...item, ownerModuleId: nextOwner };
    });
    return changed ? updated : nextItems;
  };

  const applyVennState = (
    nextModules: ModuleCircle[],
    nextItems: ItemWithPosition[],
    options?: { record?: boolean; broadcast?: boolean }
  ) => {
    if (options?.record ?? true) {
      recordHistoryIfNeeded();
    }
    const normalizedItems = assignOwnerModules(nextItems, nextModules);
    setModules(nextModules);
    setItems(normalizedItems);
    if (options?.broadcast ?? true) {
      emitCanvasUpdate(nextModules, normalizedItems);
    }
  };

  const memberships = useMemo(
    () => computeMemberships(items, modules),
    [items, modules]
  );

  const activeItem = items.find((item) => item.id === activeItemId) ?? null;
  const activeModule =
    modules.find((module) => module.id === activeModuleId) ?? null;

  useEffect(() => {
    modulesRef.current = modules;
  }, [modules]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!user || !activeWorkspaceId) return;
    const key = getListColumnsKey(user.id, activeWorkspaceId);
    fetchListViewPreference(activeWorkspaceId)
      .then((data) => {
        if (Array.isArray(data.columns)) {
          setListColumns(data.columns);
          window.localStorage.setItem(key, JSON.stringify(data.columns));
          return;
        }
        const stored = window.localStorage.getItem(key);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              setListColumns(parsed);
              return;
            }
          } catch {
            // ignore
          }
        }
        setListColumns([...DEFAULT_LIST_COLUMNS]);
      })
      .catch(() => {
        setListColumns([...DEFAULT_LIST_COLUMNS]);
      });
  }, [user, activeWorkspaceId]);

  useEffect(() => {
    if (!user || !activeWorkspaceId) return;
    const key = getListColumnsKey(user.id, activeWorkspaceId);
    window.localStorage.setItem(key, JSON.stringify(listColumns));
    if (listPrefTimerRef.current) {
      window.clearTimeout(listPrefTimerRef.current);
    }
    listPrefTimerRef.current = window.setTimeout(() => {
      saveListViewPreference(activeWorkspaceId, listColumns).catch(() => undefined);
    }, 300);
  }, [listColumns, user, activeWorkspaceId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const currentUser = await fetchMe();
        if (!active) return;
        setUser(currentUser);
        setProjectReady(false);
        if (!currentUser) {
          setSyncStatus("idle");
          setAuthReady(true);
          return;
        }
        const params = new URLSearchParams(window.location.search);
        const inviteToken = params.get("invite");
        if (inviteToken) {
          await acceptInvite(inviteToken).catch(() => undefined);
          params.delete("invite");
          const nextUrl = `${window.location.pathname}${
            params.toString() ? `?${params.toString()}` : ""
          }`;
          window.history.replaceState({}, "", nextUrl);
        }

        const [workspaceList, inviteList, notificationList] = await Promise.all([
          fetchWorkspaces(),
          fetchInvites(),
          fetchNotifications().catch(() => []),
        ]);
        if (!active) return;
        setWorkspaces(workspaceList);
        setInvites(inviteList);
        setNotifications(notificationList);
        const storageKey = getWorkspaceStorageKey(currentUser.id);
        const storedWorkspaceId =
          window.localStorage.getItem(storageKey) ?? "";
        const chosen =
          workspaceList.find((workspace) => workspace.id === storedWorkspaceId) ??
          workspaceList[0] ??
          null;
        setActiveWorkspaceId(chosen?.id ?? null);
        setActiveWorkspaceRole(chosen?.role ?? null);
        if (chosen?.id) {
          window.localStorage.setItem(storageKey, chosen.id);
        }
        setAuthReady(true);
      } catch {
        if (!active) return;
        setSyncStatus("error");
        setAuthReady(true);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user || !activeWorkspaceId) return;
    let active = true;
    setProjectReady(false);
    setSyncStatus("loading");
    fetchWorkspaceMembers(activeWorkspaceId)
      .then((membersList) => {
        if (!active) return;
        setMembers(membersList);
      })
      .catch(() => {
        if (!active) return;
        setMembers([]);
      });
    fetchProjectState(activeWorkspaceId, PROJECT_SLUG)
      .then(async (data) => {
        if (!active) return;
        const nextModules = (data.modules ?? []).map((module) => ({
          ...module,
          description: module.description ?? "",
          shape: (module.shape as ModuleCircle["shape"]) ?? "solid",
          milestones: Array.isArray(module.milestones) ? module.milestones : [],
        }));
        const nextItems = data.items ?? [];
        const normalizedItems = assignOwnerModules(nextItems, nextModules);
        const ownersChanged = normalizedItems !== nextItems;
        setModules(nextModules);
        setItems(normalizedItems);
        resetHistory(nextModules, normalizedItems);
        setSelectedItemId(normalizedItems[0]?.id ?? null);
        setActiveItemId(null);
        setItemModalOpen(false);
        setActiveModuleId(null);
        setModuleModalOpen(false);
        skipNextSaveRef.current = !ownersChanged;
        setProjectReady(true);
        setSyncStatus("idle");
      })
      .catch(() => {
        if (!active) return;
        setModules([]);
        setItems([]);
        resetHistory([], []);
        setSelectedItemId(null);
        setActiveItemId(null);
        setItemModalOpen(false);
        setActiveModuleId(null);
        setModuleModalOpen(false);
        setProjectReady(true);
        setSyncStatus("error");
      });

    return () => {
      active = false;
    };
  }, [user, activeWorkspaceId]);

  useEffect(() => {
    if (!projectReady) return;
    if (!user || !activeWorkspaceId) return;
    if (suppressSyncRef.current) {
      suppressSyncRef.current = false;
      return;
    }
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    setSyncStatus("saving");
    saveTimerRef.current = window.setTimeout(() => {
      saveProjectState(activeWorkspaceId, PROJECT_SLUG, {
        projectName: "Vennify Project",
        modules,
        items,
      })
        .then(() => setSyncStatus("idle"))
        .catch(() => setSyncStatus("error"));
    }, 400);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [modules, items, user, activeWorkspaceId, projectReady]);

  const reconcileSelections = useCallback(
    (nextModules: ModuleCircle[], nextItems: ItemWithPosition[]) => {
      if (
        selectedModuleId &&
        !nextModules.some((module) => module.id === selectedModuleId)
      ) {
        setSelectedModuleId(null);
      }
      if (
        selectedItemId &&
        !nextItems.some((item) => item.id === selectedItemId)
      ) {
        setSelectedItemId(nextItems[0]?.id ?? null);
      }
      if (activeItemId && !nextItems.some((item) => item.id === activeItemId)) {
        setActiveItemId(null);
        setItemModalOpen(false);
      }
    },
    [selectedModuleId, selectedItemId, activeItemId]
  );

  const handleUndo = useCallback(() => {
    const past = historyRef.current.past;
    if (past.length === 0) return;
    const previous = past.pop();
    if (!previous) return;
    historyRef.current.future.push(
      makeSnapshot(modulesRef.current, itemsRef.current)
    );
    updateHistoryState();
    setModules(previous.modules);
    setItems(previous.items);
    reconcileSelections(previous.modules, previous.items);
  }, [reconcileSelections]);

  const handleRedo = useCallback(() => {
    const future = historyRef.current.future;
    if (future.length === 0) return;
    const next = future.pop();
    if (!next) return;
    historyRef.current.past.push(
      makeSnapshot(modulesRef.current, itemsRef.current)
    );
    updateHistoryState();
    setModules(next.modules);
    setItems(next.items);
    reconcileSelections(next.modules, next.items);
  }, [reconcileSelections]);

  useEffect(() => {
    const handler = (evt: KeyboardEvent) => {
      const target = evt.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === "z") {
        evt.preventDefault();
        if (evt.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (
        (evt.metaKey || evt.ctrlKey) &&
        evt.key.toLowerCase() === "y"
      ) {
        evt.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    if (!user) {
      setIsLive(false);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }
    if (socketRef.current) return;
    const socket = io(API_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on("canvas:update", (payload: {
      workspaceId: string;
      modules: ModuleCircle[];
      items: ItemWithPosition[];
      clientId?: string;
    }) => {
      if (payload.clientId === clientIdRef.current) return;
      if (payload.workspaceId !== activeWorkspaceIdRef.current) return;
      suppressSyncRef.current = true;
      applyVennState(payload.modules, payload.items, {
        record: false,
        broadcast: false,
      });
      reconcileSelections(payload.modules, payload.items);
    });

    socket.on("notification:new", (notification: UserNotification) => {
      setNotifications((prev) => {
        if (prev.some((item) => item.id === notification.id)) {
          return prev;
        }
        return [notification, ...prev];
      });
      if (notification.message) {
        pushToast(notification.message);
      }
    });

    socket.on(
      "item:update",
      (payload: {
        item: ItemWithPosition;
        workspaceId: string;
        slug: string;
        clientId?: string;
      }) => {
        if (payload.clientId === clientIdRef.current) return;
        if (payload.workspaceId !== activeWorkspaceIdRef.current) return;
        if (payload.slug !== PROJECT_SLUG) return;
        const currentModules = modulesRef.current;
        const currentItems = itemsRef.current;
        const nextItems = currentItems.some((item) => item.id === payload.item.id)
          ? currentItems.map((item) =>
              item.id === payload.item.id ? payload.item : item
            )
          : [payload.item, ...currentItems];
        suppressSyncRef.current = true;
        applyVennState(currentModules, nextItems, {
          record: false,
          broadcast: false,
        });
        reconcileSelections(currentModules, nextItems);
      }
    );

    socket.on(
      "item:delete",
      (payload: {
        itemId: string;
        workspaceId: string;
        slug: string;
        clientId?: string;
      }) => {
        if (payload.clientId === clientIdRef.current) return;
        if (payload.workspaceId !== activeWorkspaceIdRef.current) return;
        if (payload.slug !== PROJECT_SLUG) return;
        const currentModules = modulesRef.current;
        const currentItems = itemsRef.current.filter(
          (item) => item.id !== payload.itemId
        );
        suppressSyncRef.current = true;
        applyVennState(currentModules, currentItems, {
          record: false,
          broadcast: false,
        });
        reconcileSelections(currentModules, currentItems);
      }
    );

    socket.on("connect", () => {
      setIsLive(true);
      if (activeWorkspaceIdRef.current) {
        socket.emit("joinProject", {
          workspaceId: activeWorkspaceIdRef.current,
          slug: PROJECT_SLUG,
        });
      }
    });

    socket.on("disconnect", () => {
      setIsLive(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setIsLive(false);
    };
  }, [user, reconcileSelections]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !user || !activeWorkspaceId) return;
    socket.emit("joinProject", {
      workspaceId: activeWorkspaceId,
      slug: PROJECT_SLUG,
    });
  }, [user, activeWorkspaceId]);

  const unreadNotificationCount = notifications.filter(
    (note) => !note.read
  ).length;

  if (!authReady) {
    return (
      <div className="app auth-loading">
        <div className="login-card">
          <h3>Loading workspace...</h3>
          <p>Checking your session and project state.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage loginUrl={`${API_URL}/auth/google`} />;
  }

  if (!projectReady) {
    return (
      <div className="app auth-loading">
        <div className="login-card">
          <h3>Loading project...</h3>
          <p>Syncing your workspace data.</p>
        </div>
      </div>
    );
  }

  const handleAddModule = () => {
    const id = crypto.randomUUID();
    const color = MODULE_COLORS[modules.length % MODULE_COLORS.length];
    const nextModules = [
      ...modulesRef.current,
      {
        id,
        name: `Module ${modulesRef.current.length + 1}`,
        description: "",
        color,
        shape: "solid",
        milestones: [],
        x: 220 + modulesRef.current.length * 90,
        y: 220 + modulesRef.current.length * 40,
        radius: 160,
        zIndex: nextZIndex(modulesRef.current.map((module) => module.zIndex)),
        locked: false,
        createdAt: new Date().toISOString(),
      },
    ];
    applyVennState(nextModules, itemsRef.current);
    setSelectedModuleId(id);
  };

  const handleAddItem = async () => {
    if (!activeWorkspaceId) return;
    const id = crypto.randomUUID();
    const nextIndex = nextZIndex(items.map((item) => item.position.zIndex));
    const newItem: ItemWithPosition = {
      id,
      title: `New item ${items.length + 1}`,
      description: "Describe this item...",
      status: "BACKLOG",
      priority: "MEDIUM",
      icon: null,
      color: null,
      ownerModuleId: null,
      startDate: new Date().toISOString(),
      dueDate: undefined,
      tags: [],
      assigneeIds: [],
      createdBy: user?.id ?? "user-1",
      customFields: [],
      relatedItemIds: [],
      position: { x: 500, y: 320, zIndex: nextIndex },
    };
    newItem.ownerModuleId = pickOwnerModuleId(newItem, modulesRef.current);
    setSyncStatus("saving");
    try {
      const created = await createItem(activeWorkspaceId, PROJECT_SLUG, {
        item: newItem,
        position: newItem.position,
      });
      const nextItems = [...itemsRef.current, created];
      applyVennState(modulesRef.current, nextItems);
      setSelectedItemId(created.id);
      setActiveItemId(created.id);
      setItemModalOpen(true);
      setSyncStatus("idle");
    } catch {
      setSyncStatus("error");
    }
  };

  const updateModule = (id: string, updates: Partial<ModuleCircle>) => {
    const nextModules = modulesRef.current.map((module) =>
      module.id === id ? { ...module, ...updates } : module
    );
    applyVennState(nextModules, itemsRef.current);
  };

  const updateItemPosition = (
    id: string,
    updates: Partial<ItemWithPosition["position"]>
  ) => {
    const nextItems = itemsRef.current.map((item) =>
      item.id === id
        ? { ...item, position: { ...item.position, ...updates } }
        : item
    );
    applyVennState(modulesRef.current, nextItems);
    emitItemUpdate(
      nextItems.find((item) => item.id === itemId) ?? currentItem
    );
  };

  const hashToUnit = (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % 1000) / 1000;
  };

  const getPositionInsideModule = (module: ModuleCircle, seed: string) => {
    const angle = hashToUnit(`${seed}-a`) * Math.PI * 2;
    const magnitude = (0.3 + hashToUnit(`${seed}-m`) * 0.5) * module.radius;
    let dx = Math.cos(angle) * magnitude;
    let dy = Math.sin(angle) * magnitude;
    const shape = module.shape ?? "solid";

    if (shape === "square") {
      const limit = module.radius * 0.7;
      dx = Math.max(-limit, Math.min(limit, dx));
      dy = Math.max(-limit, Math.min(limit, dy));
    } else if (shape === "diamond") {
      const limit = module.radius * 0.7;
      const sum = Math.abs(dx) + Math.abs(dy);
      if (sum > limit && sum !== 0) {
        const scale = limit / sum;
        dx *= scale;
        dy *= scale;
      }
    } else {
      const limit = module.radius * 0.7;
      const dist = Math.hypot(dx, dy);
      if (dist > limit && dist !== 0) {
        const scale = limit / dist;
        dx *= scale;
        dy *= scale;
      }
    }

    return { x: module.x + dx, y: module.y + dy };
  };

  const getPositionOutsideModules = (seed: string) => {
    const modules = modulesRef.current;
    if (modules.length === 0) {
      return { x: 200, y: 200 };
    }
    const minX = Math.min(...modules.map((module) => module.x));
    const minY = Math.min(...modules.map((module) => module.y));
    const maxRadius = Math.max(...modules.map((module) => module.radius));
    const offsetX = 200 + hashToUnit(`${seed}-ux`) * 160;
    const offsetY = 200 + hashToUnit(`${seed}-uy`) * 160;
    return { x: minX - maxRadius - offsetX, y: minY - maxRadius - offsetY };
  };

  const handleAddMilestoneItem = async (payload: {
    moduleId: string;
    milestoneId: string;
  }) => {
    if (!activeWorkspaceId) return;
    const module = modulesRef.current.find(
      (entry) => entry.id === payload.moduleId
    );
    if (!module) return;
    const milestones = module.milestones ?? [];
    const milestone = milestones.find(
      (entry) => entry.id === payload.milestoneId
    );
    if (!milestone) return;

    const lastItemId = milestone.itemIds?.[milestone.itemIds.length - 1];
    const lastItem = lastItemId
      ? itemsRef.current.find((item) => item.id === lastItemId)
      : null;
    const shouldBlock = !!lastItem && lastItem.status !== "DONE";

    const id = crypto.randomUUID();
    const nextIndex = nextZIndex(
      itemsRef.current.map((item) => item.position.zIndex)
    );
    const position = {
      ...getPositionInsideModule(module, id),
      zIndex: nextIndex,
    };
    const newItem: ItemWithPosition = {
      id,
      title: `Milestone task ${milestone.itemIds.length + 1}`,
      description: "Describe this item...",
      status: shouldBlock ? "ROADBLOCKED" : "TODO",
      priority: "MEDIUM",
      icon: null,
      color: null,
      ownerModuleId: module.id,
      startDate: new Date().toISOString(),
      dueDate: undefined,
      tags: [],
      assigneeIds: [],
      createdBy: user?.id ?? "user-1",
      customFields: [],
      relatedItemIds: lastItemId ? [lastItemId] : [],
      position,
    };

    setSyncStatus("saving");
    try {
      const created = await createItem(activeWorkspaceId, PROJECT_SLUG, {
        item: newItem,
        position,
      });
      const nextModules = modulesRef.current.map((entry) => {
        if (entry.id !== module.id) return entry;
        return {
          ...entry,
          milestones: (entry.milestones ?? []).map((milestoneEntry) =>
            milestoneEntry.id === milestone.id
              ? {
                  ...milestoneEntry,
                  itemIds: [...(milestoneEntry.itemIds ?? []), created.id],
                }
              : milestoneEntry
          ),
        };
      });
      const nextItems = [...itemsRef.current, created];
      applyVennState(nextModules, nextItems);
      setSelectedItemId(created.id);
      setActiveItemId(created.id);
      setItemModalOpen(true);
      setSyncStatus("idle");
    } catch {
      setSyncStatus("error");
    }
  };

  const handleAddItemToMilestone = (payload: {
    itemId: string;
    moduleId: string;
    milestoneId: string;
  }): ItemWithPosition | null => {
    if (!activeWorkspaceId) return null;
    const module = modulesRef.current.find(
      (entry) => entry.id === payload.moduleId
    );
    if (!module) return null;
    const milestone = (module.milestones ?? []).find(
      (entry) => entry.id === payload.milestoneId
    );
    if (!milestone) return null;
    if (milestone.itemIds?.includes(payload.itemId)) {
      return null;
    }
    const item = itemsRef.current.find((entry) => entry.id === payload.itemId);
    if (!item) return null;
    if (item.status === "DONE") return null;

    const lastItemId = milestone.itemIds?.[milestone.itemIds.length - 1];
    const lastItem = lastItemId
      ? itemsRef.current.find((entry) => entry.id === lastItemId)
      : null;
    const nextRelated = lastItemId
      ? Array.from(new Set([...(item.relatedItemIds ?? []), lastItemId]))
      : item.relatedItemIds ?? [];
    const shouldBlock =
      !!lastItem && lastItem.status !== "DONE" && item.status !== "DONE";

    const nextPosition = {
      ...item.position,
      ...getPositionInsideModule(module, item.id),
    };
    const nextItem: ItemWithPosition = {
      ...item,
      ownerModuleId: module.id,
      position: nextPosition,
      relatedItemIds: nextRelated,
      status: shouldBlock ? "ROADBLOCKED" : item.status,
    };

    const nextModules = modulesRef.current.map((entry) =>
      entry.id === module.id
        ? {
            ...entry,
            milestones: (entry.milestones ?? []).map((milestoneEntry) =>
              milestoneEntry.id === milestone.id
                ? {
                    ...milestoneEntry,
                    itemIds: [...(milestoneEntry.itemIds ?? []), item.id],
                  }
                : milestoneEntry
            ),
          }
        : entry
    );
    const nextItems = itemsRef.current.map((entry) =>
      entry.id === nextItem.id ? nextItem : entry
    );

    applyVennState(nextModules, nextItems);
    emitItemUpdate(nextItem);
    setSelectedItemId(nextItem.id);
    setSyncStatus("saving");
    updateItem(activeWorkspaceId, PROJECT_SLUG, nextItem.id, {
      item: {
        title: nextItem.title,
        description: nextItem.description,
        status: nextItem.status,
        priority: nextItem.priority,
        icon: nextItem.icon ?? null,
        color: nextItem.color ?? null,
        ownerModuleId: nextItem.ownerModuleId ?? null,
        startDate: nextItem.startDate,
        dueDate: nextItem.dueDate,
        tags: nextItem.tags,
        assigneeIds: nextItem.assigneeIds,
        customFields: nextItem.customFields,
        relatedItemIds: nextItem.relatedItemIds,
      },
      position: nextItem.position,
    })
      .then(() => setSyncStatus("idle"))
      .catch(() => setSyncStatus("error"));
    return nextItem;
  };

  const handleMoveItemToModule = (itemId: string, moduleId: string | null) => {
    if (!activeWorkspaceId) return;
    const currentItem = itemsRef.current.find((item) => item.id === itemId);
    if (!currentItem) return;
    let nextPosition = currentItem.position;
    if (moduleId) {
      const module = modulesRef.current.find((entry) => entry.id === moduleId);
      if (!module) return;
      nextPosition = {
        ...currentItem.position,
        ...getPositionInsideModule(module, itemId),
      };
    } else {
      nextPosition = {
        ...currentItem.position,
        ...getPositionOutsideModules(itemId),
      };
    }

    const nextItems = itemsRef.current.map((item) =>
      item.id === itemId
        ? {
            ...item,
            position: nextPosition,
            ownerModuleId: moduleId ?? null,
          }
        : item
    );
    applyVennState(modulesRef.current, nextItems);
    setSelectedItemId(itemId);

    setSyncStatus("saving");
    updateItem(activeWorkspaceId, PROJECT_SLUG, itemId, {
      item: {
        title: currentItem.title,
        description: currentItem.description,
        status: currentItem.status,
        priority: currentItem.priority,
        icon: currentItem.icon ?? null,
        color: currentItem.color ?? null,
        ownerModuleId: moduleId ?? null,
        startDate: currentItem.startDate,
        dueDate: currentItem.dueDate,
        tags: currentItem.tags,
        assigneeIds: currentItem.assigneeIds,
        customFields: currentItem.customFields,
        relatedItemIds: currentItem.relatedItemIds,
      },
      position: nextPosition,
    })
      .then(() => setSyncStatus("idle"))
      .catch(() => setSyncStatus("error"));
  };

  const handleOpenItem = (id: string) => {
    setSelectedItemId(id);
    setActiveItemId(id);
    setItemModalOpen(true);
  };

  const handleOpenModule = (id: string) => {
    setSelectedModuleId(id);
    setActiveModuleId(id);
    setModuleModalOpen(true);
  };

  const handleWorkspaceChange = (id: string) => {
    setActiveWorkspaceId(id);
    const selected = workspaces.find((workspace) => workspace.id === id) ?? null;
    setActiveWorkspaceRole(selected?.role ?? null);
    setProjectReady(false);
    if (user) {
      window.localStorage.setItem(getWorkspaceStorageKey(user.id), id);
    }
  };

  const ownedWorkspaces = workspaces.filter((workspace) => workspace.role === "OWNER");
  const sharedWorkspaces = workspaces.filter((workspace) => workspace.role !== "OWNER");
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  const handleCreateWorkspace = async () => {
    const name = window.prompt("Workspace name");
    if (!name) return;
    try {
      const workspace = await createWorkspace(name);
      setWorkspaces((prev) => [...prev, workspace]);
      handleWorkspaceChange(workspace.id);
    } catch {
      setSyncStatus("error");
    }
  };

  const handleInvite = async (payload: { email: string; role: string }) => {
    if (!activeWorkspaceId) return {};
    try {
      return await inviteToWorkspace(activeWorkspaceId, payload);
    } catch {
      setSyncStatus("error");
      return {};
    }
  };

  const startWorkspaceRename = () => {
    if (!activeWorkspace) return;
    setWorkspaceNameDraft(activeWorkspace.name);
    setEditingWorkspace(true);
    requestAnimationFrame(() => workspaceInputRef.current?.focus());
  };

  const commitWorkspaceRename = async () => {
    if (!activeWorkspace) return;
    const trimmed = workspaceNameDraft.trim();
    setEditingWorkspace(false);
    if (!trimmed || trimmed === activeWorkspace.name) return;
    try {
      setSyncStatus("saving");
      const updated = await updateWorkspace(activeWorkspace.id, trimmed);
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === updated.id ? { ...workspace, name: updated.name } : workspace
        )
      );
      await refreshWorkspaces();
      setSyncStatus("idle");
    } catch {
      setSyncStatus("error");
    }
  };

  const refreshInvites = async () => {
    try {
      const inviteList = await fetchInvites();
      setInvites(inviteList);
    } catch {
      setSyncStatus("error");
    }
  };

  const refreshNotifications = async () => {
    try {
      if (!user) return [];
      const list = await fetchNotifications();
      setNotifications(list);
      return list;
    } catch {
      setSyncStatus("error");
      setNotifications([]);
      return [];
    }
  };

  const handleToggleNotifications = async () => {
    const nextOpen = !showNotifications;
    setShowNotifications(nextOpen);
    if (nextOpen) {
      refreshInvites();
      const list = await refreshNotifications();
      const unreadIds = list.filter((note) => !note.read).map((note) => note.id);
      if (unreadIds.length > 0) {
        markNotificationsRead(unreadIds)
          .then(() => {
            setNotifications((prev) =>
              prev.map((note) =>
                unreadIds.includes(note.id) ? { ...note, read: true } : note
              )
            );
          })
          .catch(() => undefined);
      }
    }
  };

  const refreshWorkspaces = async () => {
    try {
      if (!user) return;
      const workspaceList = await fetchWorkspaces();
      setWorkspaces(workspaceList);
      const storageKey = getWorkspaceStorageKey(user.id);
      const storedWorkspaceId =
        window.localStorage.getItem(storageKey) ?? "";
      const chosen =
        workspaceList.find((workspace) => workspace.id === storedWorkspaceId) ??
        workspaceList[0] ??
        null;
      setActiveWorkspaceId(chosen?.id ?? null);
      setActiveWorkspaceRole(chosen?.role ?? null);
      if (chosen?.id) {
        window.localStorage.setItem(storageKey, chosen.id);
      }
    } catch {
      setSyncStatus("error");
    }
  };

  const handleSaveItem = async (payload: {
    item: ItemWithPosition;
    assigneeId: string | null;
    customFields: { key: string; value: string }[];
    relatedItemIds: string[];
  }) => {
    if (!activeWorkspaceId) return;
    const existing = itemsRef.current.find(
      (item) => item.id === payload.item.id
    );
    const cleanedCustomFields = payload.customFields.filter(
      (field) => field.key.trim() || field.value.trim()
    );
    const dependenciesIncomplete = payload.relatedItemIds.some((id) => {
      const dependency = itemsRef.current.find((item) => item.id === id);
      return !dependency || dependency.status !== "DONE";
    });
    const shouldAutoBlock =
      dependenciesIncomplete &&
      payload.item.status !== "DONE" &&
      ((existing && existing.status === payload.item.status) || !existing);

    const nextItem: ItemWithPosition = {
      ...payload.item,
      status: shouldAutoBlock ? "ROADBLOCKED" : payload.item.status,
      position: payload.item.position ?? existing?.position ?? {
        x: 0,
        y: 0,
        zIndex: 1,
      },
      ownerModuleId:
        payload.item.ownerModuleId ?? existing?.ownerModuleId ?? null,
      assigneeIds: payload.assigneeId ? [payload.assigneeId] : [],
      customFields: cleanedCustomFields,
      relatedItemIds: payload.relatedItemIds,
    };
    setSyncStatus("saving");
    const nextItems = itemsRef.current.map((item) =>
      item.id === nextItem.id ? nextItem : item
    );
    applyVennState(modulesRef.current, nextItems, { record: false });
    const updatedInline =
      nextItems.find((item) => item.id === nextItem.id) ?? nextItem;
    emitItemUpdate(updatedInline);
    try {
      await updateItem(activeWorkspaceId, PROJECT_SLUG, nextItem.id, {
        item: {
          title: nextItem.title,
          description: nextItem.description,
          status: nextItem.status,
          priority: nextItem.priority,
          icon: nextItem.icon ?? null,
          color: nextItem.color ?? null,
          ownerModuleId: nextItem.ownerModuleId ?? null,
          startDate: nextItem.startDate,
          dueDate: nextItem.dueDate,
          tags: nextItem.tags,
          assigneeIds: nextItem.assigneeIds,
          customFields: nextItem.customFields,
          relatedItemIds: nextItem.relatedItemIds,
        },
        position: nextItem.position,
      });
      setSyncStatus("idle");
    } catch {
      setSyncStatus("error");
    }
  };

  const handleInlineItemUpdate = (payload: {
    id: string;
    title?: string;
    status?: string;
    startDate?: string;
    dueDate?: string;
    priority?: string;
    assigneeId?: string | null;
  }) => {
    if (!activeWorkspaceId) return;
    const existing = itemsRef.current.find((item) => item.id === payload.id);
    if (!existing) return;
    const nextItem: ItemWithPosition = {
      ...existing,
      title: payload.title ?? existing.title,
      status:
        (payload.status as ItemWithPosition["status"]) ?? existing.status,
      assigneeIds:
        payload.assigneeId !== undefined
          ? payload.assigneeId
            ? [payload.assigneeId]
            : []
          : existing.assigneeIds,
      startDate:
        payload.startDate !== undefined ? payload.startDate : existing.startDate,
      dueDate: payload.dueDate !== undefined ? payload.dueDate : existing.dueDate,
      priority:
        (payload.priority as ItemWithPosition["priority"]) ?? existing.priority,
    };

    if (
      payload.status &&
      !STATUS_ORDER.includes(payload.status as (typeof STATUS_ORDER)[number])
    ) {
      return;
    }
    if (
      payload.priority &&
      !PRIORITY_ORDER.includes(payload.priority as (typeof PRIORITY_ORDER)[number])
    ) {
      return;
    }

    setSyncStatus("saving");
    const nextItems = itemsRef.current.map((item) =>
      item.id === nextItem.id ? nextItem : item
    );
    applyVennState(modulesRef.current, nextItems, { record: false });
    emitItemUpdate(nextItem);
    updateItem(activeWorkspaceId, PROJECT_SLUG, nextItem.id, {
      item: {
        title: nextItem.title,
        description: nextItem.description,
        status: nextItem.status,
        priority: nextItem.priority,
        icon: nextItem.icon ?? null,
        color: nextItem.color ?? null,
        ownerModuleId: nextItem.ownerModuleId ?? null,
        startDate: nextItem.startDate,
        dueDate: nextItem.dueDate,
        tags: nextItem.tags,
        assigneeIds: nextItem.assigneeIds,
        customFields: nextItem.customFields,
        relatedItemIds: nextItem.relatedItemIds,
      },
      position: nextItem.position,
    })
      .then(() => setSyncStatus("idle"))
      .catch(() => setSyncStatus("error"));
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!activeWorkspaceId) return;
    setSyncStatus("saving");
    const nextItems = itemsRef.current.filter((item) => item.id !== itemId);
    applyVennState(modulesRef.current, nextItems);
    emitItemDelete(itemId);
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
    }
    if (activeItemId === itemId) {
      setActiveItemId(null);
      setItemModalOpen(false);
    }
    try {
      await deleteItem(activeWorkspaceId, PROJECT_SLUG, itemId);
      setSyncStatus("idle");
    } catch {
      setSyncStatus("error");
    }
  };

  const handleSaveModule = (payload: ModuleCircle) => {
    updateModule(payload.id, {
      name: payload.name,
      description: payload.description ?? "",
      color: payload.color,
      shape: payload.shape ?? "solid",
      milestones: payload.milestones ?? [],
    });
  };

  return (
    <div className="app app-shell">
      <aside className={`app-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-brand">
          <div className="login-logo">V</div>
          <div>
            <div className="sidebar-title">Vennify</div>
            <div className="sidebar-subtitle">Workspace console</div>
          </div>
          <button
            className="icon-btn sidebar-toggle"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? "»" : "«"}
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Owned</div>
          <div className="workspace-list">
            {ownedWorkspaces.length === 0 && (
              <div className="workspace-empty">No owned workspaces.</div>
            )}
            {ownedWorkspaces.map((workspace) => (
              <button
                key={workspace.id}
                className={`workspace-item ${
                  workspace.id === activeWorkspaceId ? "active" : ""
                }`}
                onClick={() => handleWorkspaceChange(workspace.id)}
              >
                <span className="workspace-name">{workspace.name}</span>
                <span className="workspace-letter">
                  {workspace.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="workspace-role">owner</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Shared</div>
          <div className="workspace-list">
            {sharedWorkspaces.length === 0 && (
              <div className="workspace-empty">No shared workspaces.</div>
            )}
            {sharedWorkspaces.map((workspace) => (
              <button
                key={workspace.id}
                className={`workspace-item ${
                  workspace.id === activeWorkspaceId ? "active" : ""
                }`}
                onClick={() => handleWorkspaceChange(workspace.id)}
              >
                <span className="workspace-name">{workspace.name}</span>
                <span className="workspace-letter">
                  {workspace.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="workspace-role">
                  {workspace.role.toLowerCase()}
                </span>
              </button>
            ))}
          </div>
        </div>

        <button className="button secondary sidebar-action" onClick={handleCreateWorkspace}>
          {sidebarCollapsed ? "+" : "New workspace"}
        </button>
      </aside>

      <div className="app-content">
        <header className="header">
          <div className="header-title">
            <div className="header-eyebrow">Workspace</div>
            {editingWorkspace ? (
              <input
                ref={workspaceInputRef}
                className="workspace-title-input"
                value={workspaceNameDraft}
                onChange={(evt) => setWorkspaceNameDraft(evt.target.value)}
                onBlur={commitWorkspaceRename}
                onKeyDown={(evt) => {
                  if (evt.key === "Enter") commitWorkspaceRename();
                  if (evt.key === "Escape") setEditingWorkspace(false);
                }}
              />
            ) : (
              <h1
                className={`workspace-title ${
                  activeWorkspaceRole && ["OWNER", "ADMIN"].includes(activeWorkspaceRole)
                    ? "editable"
                    : ""
                }`}
                onClick={() => {
                  if (activeWorkspaceRole && ["OWNER", "ADMIN"].includes(activeWorkspaceRole)) {
                    startWorkspaceRename();
                  }
                }}
              >
                {activeWorkspace?.name ?? "Workspace"}
              </h1>
            )}
          </div>
          <div className="meta">
            <select
              className="workspace-switcher"
              value={activeWorkspaceId ?? ""}
              onChange={(evt) => handleWorkspaceChange(evt.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} ({workspace.role.toLowerCase()})
                </option>
              ))}
            </select>
            {activeWorkspaceRole &&
              ["OWNER", "ADMIN"].includes(activeWorkspaceRole) && (
                <button
                  className="button secondary header-btn"
                  onClick={() => setShowInviteModal(true)}
                >
                  Invite
                </button>
              )}
            <button
              className="button secondary header-btn notifications-btn"
              onClick={handleToggleNotifications}
            >
              Notifications
              {invites.length + unreadNotificationCount > 0 && (
                <span className="badge-pill">
                  {invites.length + unreadNotificationCount}
                </span>
              )}
            </button>
            <button
              type="button"
              className={`theme-toggle ${theme === "light" ? "on" : "off"}`}
              onClick={() =>
                setTheme((prev) => (prev === "dark" ? "light" : "dark"))
              }
              role="switch"
              aria-checked={theme === "light"}
              aria-label="Toggle light mode"
            >
              <span className="theme-toggle-text">Light mode</span>
              <span className="theme-toggle-track" aria-hidden="true">
                <span className="theme-toggle-thumb" />
              </span>
            </button>
            <span>Sync: {syncStatus}</span>
            <span className={`live-indicator ${isLive ? "on" : "off"}`}>
              <span className="live-dot" />
              {isLive ? "Live" : "Offline"}
            </span>
            <button
              className="button secondary header-btn"
              onClick={async () => {
                await logout();
                setUser(null);
                setWorkspaces([]);
                setNotifications([]);
                setActiveWorkspaceId(null);
                setActiveWorkspaceRole(null);
                setProjectReady(false);
                setModules([]);
                setItems([]);
                resetHistory([], []);
                setSelectedItemId(null);
                setActiveItemId(null);
                setItemModalOpen(false);
                setActiveModuleId(null);
                setModuleModalOpen(false);
                setInvites([]);
                setShowNotifications(false);
                setSyncStatus("idle");
              }}
            >
              Log out
            </button>
          </div>
        </header>

        <div className="view-tabs">
          <button
            className={`view-tab ${activeView === "venn" ? "active" : ""}`}
            onClick={() => setActiveView("venn")}
          >
            Venn
          </button>
          <button
            className={`view-tab ${activeView === "modules" ? "active" : ""}`}
            onClick={() => setActiveView("modules")}
          >
            Modules
          </button>
          <button
            className={`view-tab ${activeView === "list" ? "active" : ""}`}
            onClick={() => setActiveView("list")}
          >
            List
          </button>
          <button
            className={`view-tab ${activeView === "kanban" ? "active" : ""}`}
            onClick={() => setActiveView("kanban")}
          >
            Kanban
          </button>
          <button
            className={`view-tab ${activeView === "calendar" ? "active" : ""}`}
            onClick={() => setActiveView("calendar")}
          >
            Calendar
          </button>
          <div className="view-tab-divider" aria-hidden="true" />
          <button
            className={`view-tab ${activeView === "milestones" ? "active" : ""}`}
            onClick={() => setActiveView("milestones")}
          >
            Milestones
          </button>
        </div>

        <div className="main">
          {activeView === "venn" && (
            <>
              <section className="canvas-panel">
                <div className="canvas-toolbar">
                  <button
                    className="icon-btn"
                    onClick={handleUndo}
                    disabled={!historyState.canUndo}
                    aria-label="Undo"
                    title="Undo"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M7.5 7.5H3m0 0l3-3M3 7.5l3 3M9 7.5h5.5a5.5 5.5 0 110 11H11"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    className="icon-btn"
                    onClick={handleRedo}
                    disabled={!historyState.canRedo}
                    aria-label="Redo"
                    title="Redo"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M16.5 7.5H21m0 0l-3-3m3 3l-3 3M15 7.5H9.5a5.5 5.5 0 100 11H13"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    className={`icon-btn toggle ${showFullItemTitles ? "active" : ""}`}
                    onClick={() => setShowFullItemTitles((prev) => !prev)}
                    aria-pressed={showFullItemTitles}
                    aria-label="Toggle item titles"
                    title="Toggle item titles"
                  >
                    <span className="icon-text">Aa</span>
                  </button>
                  <button className="button" onClick={handleAddModule}>
                    Add module
                  </button>
                  <button className="button secondary" onClick={handleAddItem}>
                    Add item
                  </button>
                </div>
                <div className="canvas-wrap">
                <Canvas
                  modules={modules}
                  items={items}
                  showFullItemTitles={showFullItemTitles}
                  selectedItemId={selectedItemId}
                  selectedModuleId={selectedModuleId}
                  onSelectItem={(id) => setSelectedItemId(id)}
                  onOpenItem={(id) => handleOpenItem(id)}
                  onSelectModule={(id) => setSelectedModuleId(id)}
                  onUpdateModule={updateModule}
                  onUpdateItemPosition={updateItemPosition}
                  onBatchUpdate={(nextModules, nextItems) => {
                    applyVennState(nextModules, nextItems);
                  }}
                  onInteractionStart={beginHistoryGesture}
                  onInteractionEnd={endHistoryGesture}
                  onOpenModule={handleOpenModule}
                />
                {modules.length === 0 && (
                  <div className="canvas-empty">
                    <div className="canvas-empty-card">
                      <h3>Start your workspace</h3>
                      <p>Add a module to begin organizing your project.</p>
                      <button className="button" onClick={handleAddModule}>
                        Add a Module
                      </button>
                    </div>
                  </div>
                )}
                </div>
              </section>

              <aside className={`side-panel floating ${isPanelOpen ? "open" : "closed"}`}>
                <div className="side-panel-header">
                  <div>
                    <h2>Items</h2>
                    <div className="meta">List</div>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={() => setIsPanelOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <section className="panel-section">
                  <ItemList
                    items={items}
                    memberships={memberships}
                    modules={modules}
                    selectedItemId={selectedItemId}
                    onSelect={(id) => setSelectedItemId(id)}
                    onOpen={handleOpenItem}
                  />
                </section>
              </aside>
              <button
                className={`panel-toggle ${isPanelOpen ? "open" : "closed"}`}
                onClick={() => setIsPanelOpen((prev) => !prev)}
                aria-label="Toggle item panel"
              >
                {isPanelOpen ? "›" : "‹"}
              </button>
            </>
          )}

          {activeView === "modules" && (
            <ModulesView
              modules={modules}
              items={items}
              members={members}
              onUpdateItem={handleInlineItemUpdate}
              onMoveItemToModule={handleMoveItemToModule}
              columnOrder={listColumns}
              onColumnOrderChange={setListColumns}
              onOpenItem={handleOpenItem}
              onOpenModule={handleOpenModule}
            />
          )}

          {activeView === "list" && (
            <section className="view-panel">
              <ListView
                items={items}
                modules={modules}
                members={members}
                onOpenItem={handleOpenItem}
                onUpdateItem={handleInlineItemUpdate}
                onOpenModule={handleOpenModule}
                onMoveItemToModule={handleMoveItemToModule}
                columnOrder={listColumns}
                onColumnOrderChange={setListColumns}
              />
            </section>
          )}

          {activeView === "kanban" && (
            <section className="view-panel">
              <KanbanView
                items={items}
                modules={modules}
                onOpenItem={handleOpenItem}
                onUpdateStatus={(id, status) =>
                  handleInlineItemUpdate({ id, status })
                }
              />
            </section>
          )}

          {activeView === "calendar" && (
            <section className="view-panel">
              <CalendarView items={items} onOpenItem={handleOpenItem} />
            </section>
          )}

          {activeView === "milestones" && (
            <section className="view-panel">
              <MilestonesView
                modules={modules}
                items={items}
                members={members}
                onOpenItem={handleOpenItem}
                onAddMilestoneItem={handleAddMilestoneItem}
                onUpdateItem={handleInlineItemUpdate}
                onOpenModule={handleOpenModule}
                onMoveItemToModule={handleMoveItemToModule}
                columnOrder={listColumns}
                onColumnOrderChange={setListColumns}
              />
            </section>
          )}
        </div>
      </div>

      <InviteModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onSend={handleInvite}
      />

      {showNotifications && (
        <div
          className="notifications-overlay"
          onClick={() => setShowNotifications(false)}
        >
          <div onClick={(evt) => evt.stopPropagation()}>
            <NotificationsPanel
              invites={invites}
              notifications={notifications}
              onClose={() => setShowNotifications(false)}
              onAccept={async (token) => {
                await acceptInvite(token);
                await refreshWorkspaces();
                await refreshInvites();
                setShowNotifications(false);
              }}
            />
          </div>
        </div>
      )}

      <ItemModal
        open={itemModalOpen}
        item={activeItem}
        modules={modules}
        members={members}
        workspaceId={activeWorkspaceId}
        projectSlug={PROJECT_SLUG}
        onClose={() => setItemModalOpen(false)}
        onSave={handleSaveItem}
        onAddToMilestone={handleAddItemToMilestone}
        onDelete={handleDeleteItem}
      />

      <ModuleModal
        open={moduleModalOpen}
        module={activeModule}
        modules={modules}
        items={items}
        onClose={() => setModuleModalOpen(false)}
        onSave={handleSaveModule}
      />

      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className="toast">
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default App;

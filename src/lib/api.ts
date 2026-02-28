import { ItemWithPosition, ModuleCircle } from "../types";

export const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type ProjectState = {
  project: { id: string; slug: string; name: string };
  modules: ModuleCircle[];
  items: ItemWithPosition[];
};

export type WorkspaceSummary = {
  id: string;
  slug: string;
  name: string;
  role: string;
};

export const fetchProjectState = async (
  workspaceId: string,
  slug: string
): Promise<ProjectState> => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/projects/${slug}/state`,
    {
      credentials: "include",
    }
  );
  if (!response.ok) {
    throw new Error("Failed to load project state.");
  }
  return response.json();
};

export const saveProjectState = async (
  workspaceId: string,
  slug: string,
  payload: {
    projectName?: string;
    modules: ModuleCircle[];
    items: ItemWithPosition[];
  }
) => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/projects/${slug}/state`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    throw new Error("Failed to save project state.");
  }
};

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

export const fetchMe = async (): Promise<AuthUser | null> => {
  const response = await fetch(`${API_URL}/api/me`, {
    credentials: "include",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { user: AuthUser | null };
  return data.user ?? null;
};

export const fetchWorkspaces = async (): Promise<WorkspaceSummary[]> => {
  const response = await fetch(`${API_URL}/api/workspaces`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to load workspaces.");
  }
  const data = (await response.json()) as { workspaces: WorkspaceSummary[] };
  return data.workspaces;
};

export type WorkspaceInvite = {
  id: string;
  email: string;
  role: string;
  token: string;
  workspace: { id: string; name: string };
  createdAt: string;
};

export type UserNotification = {
  id: string;
  userId: string;
  workspaceId: string;
  itemId?: string | null;
  type: string;
  message: string;
  meta?: any;
  read: boolean;
  createdAt: string;
};

export const fetchInvites = async (): Promise<WorkspaceInvite[]> => {
  const response = await fetch(`${API_URL}/api/invites`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to load invites.");
  }
  const data = (await response.json()) as { invites: WorkspaceInvite[] };
  return data.invites;
};

export const fetchNotifications = async (): Promise<UserNotification[]> => {
  const response = await fetch(`${API_URL}/api/notifications`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to load notifications.");
  }
  const data = (await response.json()) as { notifications: UserNotification[] };
  return data.notifications;
};

export const markNotificationsRead = async (ids?: string[]) => {
  const response = await fetch(`${API_URL}/api/notifications/mark-read`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(ids && ids.length > 0 ? { ids } : {}),
  });
  if (!response.ok) {
    throw new Error("Failed to update notifications.");
  }
};

export const createWorkspace = async (name: string): Promise<WorkspaceSummary> => {
  const response = await fetch(`${API_URL}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error("Failed to create workspace.");
  }
  const data = (await response.json()) as { workspace: WorkspaceSummary };
  return data.workspace;
};

export const updateWorkspace = async (
  workspaceId: string,
  name: string
): Promise<WorkspaceSummary> => {
  const response = await fetch(`${API_URL}/api/workspaces/${workspaceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error("Failed to update workspace.");
  }
  const data = (await response.json()) as { workspace: WorkspaceSummary };
  return data.workspace;
};

export const inviteToWorkspace = async (
  workspaceId: string,
  payload: { email: string; role?: string }
) => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/invite`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    throw new Error("Failed to send invite.");
  }
  return response.json();
};

export const acceptInvite = async (token: string) => {
  const response = await fetch(`${API_URL}/api/invites/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    throw new Error("Failed to accept invite.");
  }
};

export type WorkspaceMember = {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
};

export const fetchWorkspaceMembers = async (
  workspaceId: string
): Promise<WorkspaceMember[]> => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/members`,
    {
      credentials: "include",
    }
  );
  if (!response.ok) {
    throw new Error("Failed to load members.");
  }
  const data = (await response.json()) as { members: WorkspaceMember[] };
  return data.members;
};

export const fetchListViewPreference = async (
  workspaceId: string
): Promise<{ columns: string[] | null }> => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/preferences/list-view`,
    {
      credentials: "include",
    }
  );
  if (!response.ok) {
    throw new Error("Failed to load list preferences.");
  }
  return response.json();
};

export const saveListViewPreference = async (
  workspaceId: string,
  columns: string[]
): Promise<void> => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/preferences/list-view`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ columns }),
    }
  );
  if (!response.ok) {
    throw new Error("Failed to save list preferences.");
  }
};

export const createItem = async (
  workspaceId: string,
  slug: string,
  payload: {
    item: {
      id: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      icon?: string | null;
      color?: string | null;
      ownerModuleId?: string | null;
      startDate?: string;
      dueDate?: string;
      tags: string[];
      assigneeIds: string[];
      customFields: { key: string; value: string }[];
      relatedItemIds: string[];
      createdBy: string;
    };
    position: { x: number; y: number; zIndex: number };
  }
) => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/projects/${slug}/items`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    throw new Error("Failed to create item.");
  }
  const data = (await response.json()) as { item: ItemWithPosition };
  return data.item;
};

export const updateItem = async (
  workspaceId: string,
  slug: string,
  itemId: string,
  payload: {
    item: {
      title: string;
      description: string;
      status: string;
      priority: string;
      icon?: string | null;
      color?: string | null;
      ownerModuleId?: string | null;
      startDate?: string;
      dueDate?: string;
      tags: string[];
      assigneeIds: string[];
      customFields: { key: string; value: string }[];
      relatedItemIds: string[];
    };
    position?: { x: number; y: number; zIndex: number };
  }
) => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/projects/${slug}/items/${itemId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    throw new Error("Failed to update item.");
  }
  const data = (await response.json()) as { item: ItemWithPosition };
  return data.item;
};

export const deleteItem = async (
  workspaceId: string,
  slug: string,
  itemId: string
) => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/projects/${slug}/items/${itemId}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );
  if (!response.ok) {
    throw new Error("Failed to delete item.");
  }
};

export type ItemComment = {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string | null; email: string; avatarUrl: string | null };
};

export type ItemActivity = {
  id: string;
  action: string;
  meta?: any;
  createdAt: string;
  actor: { id: string; name: string | null; email: string; avatarUrl: string | null };
};

export const fetchItemComments = async (
  workspaceId: string,
  slug: string,
  itemId: string
): Promise<ItemComment[]> => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/projects/${slug}/items/${itemId}/comments`,
    { credentials: "include" }
  );
  if (!response.ok) {
    throw new Error("Failed to load comments.");
  }
  const data = (await response.json()) as { comments: ItemComment[] };
  return data.comments;
};

export const addItemComment = async (
  workspaceId: string,
  slug: string,
  itemId: string,
  body: string
): Promise<ItemComment> => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/projects/${slug}/items/${itemId}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ body }),
    }
  );
  if (!response.ok) {
    throw new Error("Failed to add comment.");
  }
  const data = (await response.json()) as { comment: ItemComment };
  return data.comment;
};

export const fetchItemActivity = async (
  workspaceId: string,
  slug: string,
  itemId: string
): Promise<ItemActivity[]> => {
  const response = await fetch(
    `${API_URL}/api/workspaces/${workspaceId}/projects/${slug}/items/${itemId}/activity`,
    { credentials: "include" }
  );
  if (!response.ok) {
    throw new Error("Failed to load activity.");
  }
  const data = (await response.json()) as { activity: ItemActivity[] };
  return data.activity;
};

export const logout = async () => {
  await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
};

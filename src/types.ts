export type ID = string;

export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export type ItemStatus =
  | "BACKLOG"
  | "TODO"
  | "IN_PROGRESS"
  | "REVIEW"
  | "ROADBLOCKED"
  | "DONE";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ModuleCircle = {
  id: ID;
  name: string;
  description: string;
  color: string;
  shape: "solid" | "outline" | "dashed" | "square" | "diamond";
  x: number;
  y: number;
  radius: number;
  zIndex: number;
  locked: boolean;
  createdAt?: string;
  milestones?: { id: ID; name: string; itemIds: ID[] }[];
};

export type Item = {
  id: ID;
  title: string;
  description: string;
  status: ItemStatus;
  priority: Priority;
  icon?: string | null;
  color?: string | null;
  ownerModuleId?: ID | null;
  startDate?: string;
  dueDate?: string;
  tags: string[];
  assigneeIds: ID[];
  createdBy: ID;
  customFields: { key: string; value: string }[];
  relatedItemIds: ID[];
};

export type ItemPosition = {
  x: number;
  y: number;
  zIndex: number;
};

export type ItemWithPosition = Item & {
  position: ItemPosition;
};

export type Membership = {
  itemId: ID;
  moduleIds: ID[];
};

import React, { useEffect, useMemo, useState } from "react";
import { ItemWithPosition, ModuleCircle } from "../types";
import { WorkspaceMember } from "../lib/api";

type ColumnKey =
  | "title"
  | "status"
  | "assignee"
  | "startDate"
  | "dueDate"
  | "priority";

type ListViewProps = {
  items: ItemWithPosition[];
  modules: ModuleCircle[];
  members: WorkspaceMember[];
  onOpenItem: (id: string) => void;
  onUpdateItem: (payload: {
    id: string;
    title?: string;
    status?: string;
    startDate?: string;
    dueDate?: string;
    priority?: string;
    assigneeId?: string | null;
  }) => void;
  onOpenModule: (id: string) => void;
  onMoveItemToModule: (itemId: string, moduleId: string | null) => void;
  columnOrder: ColumnKey[];
  onColumnOrderChange: (next: ColumnKey[]) => void;
  title?: string;
  showToolbar?: boolean;
  initialGroupBy?: GroupKey;
  scrollable?: boolean;
  flat?: boolean;
};

const STATUS_ORDER = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "REVIEW",
  "ROADBLOCKED",
  "DONE",
] as const;

type GroupKey = "module" | "status" | "due";
type GroupKind = GroupKey | "flat";

const GROUP_OPTIONS: { value: GroupKey; label: string }[] = [
  { value: "module", label: "Group by module" },
  { value: "status", label: "Group by status" },
  { value: "due", label: "Group by due date" },
];

const statusLabel = (status: string) =>
  status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());

const statusClass = (status: string) =>
  `status-${status.toLowerCase().replace(/_/g, "-")}`;

const formatLongDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

export const ListView: React.FC<ListViewProps> = ({
  items,
  modules,
  members,
  onOpenItem,
  onUpdateItem,
  onOpenModule,
  onMoveItemToModule,
  columnOrder,
  onColumnOrderChange,
  title = "Tasks",
  showToolbar = true,
  initialGroupBy,
  scrollable = true,
  flat = false,
}) => {
  const [groupBy, setGroupBy] = useState<GroupKey>(initialGroupBy ?? "module");
  const [editingTitles, setEditingTitles] = useState<Record<string, string>>(
    {}
  );
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [openAssigneeId, setOpenAssigneeId] = useState<string | null>(null);
  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members]
  );

  useEffect(() => {
    if (initialGroupBy && initialGroupBy !== groupBy) {
      setGroupBy(initialGroupBy);
    }
  }, [initialGroupBy, groupBy]);

  const groups = useMemo(() => {
    if (flat) {
      return [
        {
          key: "all",
          title: "All",
          color: "rgba(230, 237, 247, 0.3)",
          items,
          kind: "flat" as GroupKind,
        },
      ];
    }

    if (groupBy === "module") {
      const moduleGroups = modules.map((module) => {
        const groupItems = items.filter(
          (item) => (item.ownerModuleId ?? null) === module.id
        );
        return {
          key: module.id,
          title: module.name,
          color: module.color,
          items: groupItems,
          kind: "module" as GroupKind,
        };
      });
      const unassigned = items.filter(
        (item) =>
          !item.ownerModuleId ||
          !modules.some((module) => module.id === item.ownerModuleId)
      );
      if (unassigned.length > 0) {
        moduleGroups.push({
          key: "unassigned",
          title: "Unassigned",
          color: "rgba(230, 237, 247, 0.3)",
          items: unassigned,
          kind: "module" as GroupKind,
        });
      }
      return moduleGroups;
    }

    if (groupBy === "status") {
      return STATUS_ORDER.map((status) => ({
        key: status,
        title: statusLabel(status),
        color: "rgba(230, 237, 247, 0.3)",
        items: items.filter((item) => item.status === status),
        kind: "status" as GroupKind,
        status,
      }));
    }

    const map = new Map<string, ItemWithPosition[]>();
    items.forEach((item) => {
      const key = item.dueDate ? item.dueDate.slice(0, 10) : "no-date";
      const entry = map.get(key) ?? [];
      entry.push(item);
      map.set(key, entry);
    });
    const sortedKeys = Array.from(map.keys()).sort((a, b) => {
      if (a === "no-date") return 1;
      if (b === "no-date") return -1;
      return a.localeCompare(b);
    });
    return sortedKeys.map((key) => ({
      key,
      title: key === "no-date" ? "No due date" : formatLongDate(key),
      color: "rgba(230, 237, 247, 0.3)",
      items: map.get(key) ?? [],
      kind: "due" as GroupKind,
    }));
  }, [flat, groupBy, items, modules]);

  const columnDefs: Record<
    ColumnKey,
    { label: string; width: string }
  > = {
    title: { label: "Title", width: "2.2fr" },
    status: { label: "Status", width: "1fr" },
    assignee: { label: "Assignee", width: "1.2fr" },
    startDate: { label: "Start", width: "1fr" },
    dueDate: { label: "Due", width: "1fr" },
    priority: { label: "Priority", width: "1fr" },
  };

  const orderedColumns = columnOrder.filter((key) => key in columnDefs);
  const gridTemplate = orderedColumns
    .map((key) => columnDefs[key].width)
    .join(" ");

  const assigneeOptions = useMemo(() => {
    return members
      .map((member) => ({
        id: member.id,
        label: member.name ?? member.email,
        avatarUrl: member.avatarUrl ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [members]);

  useEffect(() => {
    if (!openAssigneeId) return;
    const handleClose = () => setOpenAssigneeId(null);
    window.addEventListener("click", handleClose);
    return () => window.removeEventListener("click", handleClose);
  }, [openAssigneeId]);

  const handleReorder = (from: ColumnKey, to: ColumnKey) => {
    if (from === to) return;
    const current = [...orderedColumns];
    const fromIndex = current.indexOf(from);
    const toIndex = current.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return;
    current.splice(fromIndex, 1);
    current.splice(toIndex, 0, from);
    onColumnOrderChange(current);
  };

  const openItem = (evt: React.MouseEvent, id: string) => {
    const target = evt.target as HTMLElement;
    if (
      target.closest("input") ||
      target.closest("select") ||
      target.closest("button")
    ) {
      return;
    }
    onOpenItem(id);
  };

  const getDraggedItemId = (evt: React.DragEvent) =>
    evt.dataTransfer.getData("application/x-vennify-item") ||
    evt.dataTransfer.getData("text/plain");

  const handleGroupDrop = (evt: React.DragEvent, groupKey: string) => {
    if (flat) return;
    if (groupBy !== "module") return;
    evt.preventDefault();
    const itemId = draggingItemId ?? getDraggedItemId(evt);
    if (!itemId) return;
    setDragOverGroup(null);
    setDraggingItemId(null);
    const moduleId = groupKey === "unassigned" ? null : groupKey;
    onMoveItemToModule(itemId, moduleId);
  };

  const handleGroupDragOver = (evt: React.DragEvent, groupKey: string) => {
    if (flat) return;
    if (groupBy !== "module") return;
    if (!draggingItemId && !getDraggedItemId(evt)) return;
    evt.preventDefault();
    if (dragOverGroup !== groupKey) {
      setDragOverGroup(groupKey);
    }
  };

  const startTitleEdit = (item: ItemWithPosition) => {
    setEditingTitles((prev) => ({
      ...prev,
      [item.id]: prev[item.id] ?? item.title,
    }));
  };

  const cancelTitleEdit = (itemId: string) => {
    setEditingTitles((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const commitTitleEdit = (item: ItemWithPosition) => {
    const current = editingTitles[item.id];
    const trimmed = current?.trim() ?? "";
    if (trimmed && trimmed !== item.title) {
      onUpdateItem({ id: item.id, title: trimmed });
    }
    cancelTitleEdit(item.id);
  };

  return (
    <div className={`list-view ${scrollable ? "" : "static"}`}>
      {showToolbar && (
        <div className="list-toolbar">
          <div className="list-toolbar-title">{title}</div>
          <select
            className="list-group-select"
            value={groupBy}
            onChange={(evt) => setGroupBy(evt.target.value as GroupKey)}
          >
            {GROUP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {groups.map((group) => {
        if (group.items.length === 0) return null;
        return (
          <section
            key={group.key}
            className={`list-group ${
              dragOverGroup === group.key ? "drag-over" : ""
            }`}
            onDragOver={(evt) => handleGroupDragOver(evt, group.key)}
            onDrop={(evt) => handleGroupDrop(evt, group.key)}
            onDragLeave={() => {
              if (dragOverGroup === group.key) {
                setDragOverGroup(null);
              }
            }}
          >
            {group.kind !== "flat" && (
              <div className="list-group-header">
                {group.kind === "due" ? (
                  <h3 className="group-date">{group.title}</h3>
                ) : group.kind === "status" ? (
                  <span className={`group-pill ${statusClass(group.status ?? "")}`}>
                    {group.title}
                  </span>
                ) : (
                  <button
                    className="group-pill module-pill"
                    style={{ background: group.color, color: "#0b1020" }}
                    onClick={() => onOpenModule(group.key)}
                  >
                    {group.title}
                  </button>
                )}
                <span className="group-count">{group.items.length}</span>
              </div>
            )}
            <div className="list-table">
              <div
                className="list-table-header"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {orderedColumns.map((key) => (
                  <div
                    key={key}
                    className="list-header-cell"
                    draggable
                    onDragStart={(evt) =>
                      evt.dataTransfer.setData("text/plain", key)
                    }
                    onDragOver={(evt) => evt.preventDefault()}
                    onDrop={(evt) => {
                      const from = evt.dataTransfer.getData("text/plain") as ColumnKey;
                      handleReorder(from, key);
                    }}
                  >
                    <span className="drag-handle">⋮⋮</span>
                    {columnDefs[key].label}
                  </div>
                ))}
              </div>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className={`list-table-row ${
                    draggingItemId === item.id ? "dragging" : ""
                  }`}
                  onClick={(evt) => openItem(evt, item.id)}
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  {orderedColumns.map((key) => {
                    if (key === "title") {
                      return (
                        <div key={key} className="list-title-cell">
                          {!flat && groupBy === "module" && (
                            <button
                              className="row-drag-handle"
                              type="button"
                              draggable
                              onDragStart={(evt) => {
                                evt.dataTransfer.effectAllowed = "move";
                                evt.dataTransfer.setData(
                                  "application/x-vennify-item",
                                  item.id
                                );
                                evt.dataTransfer.setData("text/plain", item.id);
                                setDraggingItemId(item.id);
                              }}
                              onDragEnd={() => setDraggingItemId(null)}
                              onClick={(evt) => evt.stopPropagation()}
                              aria-label="Drag item"
                              title="Drag item"
                            >
                              ⋮⋮
                            </button>
                          )}
                          {editingTitles[item.id] !== undefined ? (
                            <input
                              className="list-input title"
                              value={editingTitles[item.id]}
                              autoFocus
                              onChange={(evt) =>
                                setEditingTitles((prev) => ({
                                  ...prev,
                                  [item.id]: evt.target.value,
                                }))
                              }
                              onClick={(evt) => evt.stopPropagation()}
                              onBlur={() => commitTitleEdit(item)}
                              onKeyDown={(evt) => {
                                if (evt.key === "Enter") {
                                  commitTitleEdit(item);
                                }
                                if (evt.key === "Escape") {
                                  cancelTitleEdit(item.id);
                                }
                              }}
                            />
                          ) : (
                            <span className="title">{item.title}</span>
                          )}
                          {editingTitles[item.id] === undefined && (
                            <button
                              className="title-edit-btn"
                              onClick={(evt) => {
                                evt.stopPropagation();
                                startTitleEdit(item);
                              }}
                              aria-label="Edit title"
                              title="Edit title"
                            >
                              ✎
                            </button>
                          )}
                        </div>
                      );
                    }
                    if (key === "status") {
                      return (
                        <select
                          key={key}
                          className={`list-select status-pill ${statusClass(item.status)}`}
                          value={item.status}
                          onChange={(evt) =>
                            onUpdateItem({ id: item.id, status: evt.target.value })
                          }
                        >
                          {STATUS_ORDER.map((status) => (
                            <option key={status} value={status}>
                              {statusLabel(status)}
                            </option>
                          ))}
                        </select>
                      );
                    }
                    if (key === "assignee") {
                      const currentAssignee = item.assigneeIds?.[0] ?? "";
                      const currentMember = memberMap.get(currentAssignee);
                      const currentLabel =
                        currentMember?.name ?? currentMember?.email ?? "Unassigned";
                      const currentAvatar = currentMember?.avatarUrl ?? null;
                      const initials = currentLabel
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((part) => part[0])
                        .join("")
                        .toUpperCase();
                      return (
                        <div key={key} className="assignee-cell">
                          <button
                            type="button"
                            className="assignee-button"
                            onClick={(evt) => {
                              evt.stopPropagation();
                              setOpenAssigneeId((prev) =>
                                prev === item.id ? null : item.id
                              );
                            }}
                            aria-haspopup="listbox"
                            aria-expanded={openAssigneeId === item.id}
                          >
                            {currentAvatar ? (
                              <img
                                src={currentAvatar}
                                alt={currentLabel}
                                className="assignee-avatar"
                              />
                            ) : (
                              <span className="assignee-avatar initials">
                                {initials || "?"}
                              </span>
                            )}
                            <span className="assignee-label">{currentLabel}</span>
                            <span className="assignee-chevron">▾</span>
                          </button>
                          {openAssigneeId === item.id && (
                            <div
                              className="assignee-menu"
                              role="listbox"
                              onClick={(evt) => evt.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="assignee-option"
                                onClick={() => {
                                  onUpdateItem({
                                    id: item.id,
                                    assigneeId: null,
                                  });
                                  setOpenAssigneeId(null);
                                }}
                              >
                                <span className="assignee-avatar initials">?</span>
                                <span>Unassigned</span>
                              </button>
                              {assigneeOptions.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  className="assignee-option"
                                  onClick={() => {
                                    onUpdateItem({
                                      id: item.id,
                                      assigneeId: option.id,
                                    });
                                    setOpenAssigneeId(null);
                                  }}
                                >
                                  {option.avatarUrl ? (
                                    <img
                                      src={option.avatarUrl}
                                      alt={option.label}
                                      className="assignee-avatar"
                                    />
                                  ) : (
                                    <span className="assignee-avatar initials">
                                      {option.label
                                        .split(" ")
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((part) => part[0])
                                        .join("")
                                        .toUpperCase() || "?"}
                                    </span>
                                  )}
                                  <span>{option.label}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (key === "startDate") {
                      return (
                        <input
                          key={key}
                          className="list-input"
                          type="date"
                          value={item.startDate ? item.startDate.slice(0, 10) : ""}
                          onChange={(evt) =>
                            onUpdateItem({
                              id: item.id,
                              startDate: evt.target.value
                                ? new Date(evt.target.value).toISOString()
                                : undefined,
                            })
                          }
                        />
                      );
                    }
                    if (key === "dueDate") {
                      return (
                        <input
                          key={key}
                          className="list-input"
                          type="date"
                          value={item.dueDate ? item.dueDate.slice(0, 10) : ""}
                          onChange={(evt) =>
                            onUpdateItem({
                              id: item.id,
                              dueDate: evt.target.value
                                ? new Date(evt.target.value).toISOString()
                                : undefined,
                            })
                          }
                        />
                      );
                    }
                    if (key === "priority") {
                      return (
                        <select
                          key={key}
                          className={`list-select priority-select priority-${item.priority.toLowerCase()}`}
                          value={item.priority}
                          onChange={(evt) =>
                            onUpdateItem({ id: item.id, priority: evt.target.value })
                          }
                        >
                          {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => (
                            <option key={value} value={value}>
                              {value.toLowerCase()}
                            </option>
                          ))}
                        </select>
                      );
                    }
                    return null;
                  })}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

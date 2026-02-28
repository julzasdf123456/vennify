import React, { useState } from "react";
import { ItemWithPosition } from "../types";

type KanbanViewProps = {
  items: ItemWithPosition[];
  modules: { id: string; color: string }[];
  onOpenItem: (id: string) => void;
  onUpdateStatus: (id: string, status: string) => void;
};

const STATUS_ORDER = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "REVIEW",
  "ROADBLOCKED",
  "DONE",
] as const;

const statusLabel = (status: string) =>
  status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());

const statusClass = (status: string) =>
  `status-${status.toLowerCase().replace(/_/g, "-")}`;

export const KanbanView: React.FC<KanbanViewProps> = ({
  items,
  modules,
  onOpenItem,
  onUpdateStatus,
}) => {
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<
    "module" | "startDate" | "dueDate" | "priority"
  >("module");
  const moduleColorMap = new Map(modules.map((module) => [module.id, module.color]));
  const moduleOrder = new Map(modules.map((module, index) => [module.id, index]));

  const sortItems = (list: ItemWithPosition[]) => {
    const next = [...list];
    next.sort((a, b) => {
      if (sortBy === "module") {
        const aIndex =
          (a.ownerModuleId && moduleOrder.get(a.ownerModuleId)) ?? 9999;
        const bIndex =
          (b.ownerModuleId && moduleOrder.get(b.ownerModuleId)) ?? 9999;
        if (aIndex !== bIndex) return aIndex - bIndex;
        const aName = a.title.toLowerCase();
        const bName = b.title.toLowerCase();
        return aName.localeCompare(bName);
      }
      if (sortBy === "startDate") {
        const aTime = a.startDate ? new Date(a.startDate).getTime() : Infinity;
        const bTime = b.startDate ? new Date(b.startDate).getTime() : Infinity;
        if (aTime !== bTime) return aTime - bTime;
        return a.title.localeCompare(b.title);
      }
      if (sortBy === "dueDate") {
        const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (aTime !== bTime) return aTime - bTime;
        return a.title.localeCompare(b.title);
      }
      const priorityRank = (value: string) => {
        const normalized = value.toLowerCase();
        if (normalized === "critical") return 0;
        if (normalized === "high") return 1;
        if (normalized === "medium") return 2;
        return 3;
      };
      const aRank = priorityRank(a.priority);
      const bRank = priorityRank(b.priority);
      if (aRank !== bRank) return aRank - bRank;
      return a.title.localeCompare(b.title);
    });
    return next;
  };

  const handleDrop = (evt: React.DragEvent, status: string) => {
    evt.preventDefault();
    const itemId =
      draggingItemId ??
      evt.dataTransfer.getData("application/x-vennify-item") ??
      evt.dataTransfer.getData("text/plain");
    if (!itemId) return;
    setDragOverStatus(null);
    setDraggingItemId(null);
    onUpdateStatus(itemId, status);
  };

  const handleDragOver = (evt: React.DragEvent, status: string) => {
    if (!draggingItemId && !evt.dataTransfer.types.includes("text/plain")) {
      return;
    }
    evt.preventDefault();
    if (dragOverStatus !== status) {
      setDragOverStatus(status);
    }
  };

  return (
    <div className="kanban-view">
      <div className="kanban-toolbar">
        <span className="kanban-toolbar-label">Sort by</span>
        <select
          className="kanban-sort-select"
          value={sortBy}
          onChange={(evt) =>
            setSortBy(
              evt.target.value as "module" | "startDate" | "dueDate" | "priority"
            )
          }
        >
          <option value="module">Module</option>
          <option value="startDate">Start date</option>
          <option value="dueDate">Due date</option>
          <option value="priority">Priority</option>
        </select>
      </div>
      <div className="kanban-columns">
        {STATUS_ORDER.map((status) => {
          const columnItems = sortItems(
            items.filter((item) => item.status === status)
          );
          return (
            <section
              key={status}
              className={`kanban-column ${statusClass(status)} ${
                dragOverStatus === status ? "drag-over" : ""
              }`}
              onDragOver={(evt) => handleDragOver(evt, status)}
              onDrop={(evt) => handleDrop(evt, status)}
              onDragLeave={() => {
                if (dragOverStatus === status) {
                  setDragOverStatus(null);
                }
              }}
            >
              <div className="kanban-column-header">
                <span className="kanban-status">
                  <span className={`status-dot ${statusClass(status)}`} />
                  {statusLabel(status)}
                </span>
                <span className="kanban-count">{columnItems.length}</span>
              </div>
              <div className="kanban-cards">
                {columnItems.map((item) => (
                  <button
                    key={item.id}
                    className="kanban-card"
                    onClick={() => onOpenItem(item.id)}
                    draggable
                    onDragStart={(evt) => {
                      evt.dataTransfer.effectAllowed = "move";
                      evt.dataTransfer.setData("application/x-vennify-item", item.id);
                      evt.dataTransfer.setData("text/plain", item.id);
                      setDraggingItemId(item.id);
                    }}
                    onDragEnd={() => setDraggingItemId(null)}
                    style={{
                      borderLeftColor:
                        (item.ownerModuleId &&
                          moduleColorMap.get(item.ownerModuleId)) ??
                        "transparent",
                    }}
                  >
                    <div className="title">{item.title}</div>
                  <div className="meta kanban-meta">
                    <span
                      className={`priority-pill priority-${item.priority.toLowerCase()}`}
                    >
                      {item.priority.toLowerCase()}
                    </span>
                    {item.dueDate
                      ? ` · Due ${new Date(item.dueDate).toLocaleDateString()}`
                      : ""}
                  </div>
                  </button>
                ))}
                {columnItems.length === 0 && (
                  <div className="kanban-empty">No items</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

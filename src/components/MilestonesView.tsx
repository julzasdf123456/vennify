import React, { useEffect, useMemo, useState } from "react";
import { ItemWithPosition, ModuleCircle } from "../types";
import { WorkspaceMember } from "../lib/api";
import { ListView } from "./ListView";

type MilestonesViewProps = {
  modules: ModuleCircle[];
  items: ItemWithPosition[];
  members: WorkspaceMember[];
  onOpenItem: (id: string) => void;
  onAddMilestoneItem: (payload: { moduleId: string; milestoneId: string }) => void;
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
  columnOrder: ("title" | "status" | "assignee" | "startDate" | "dueDate" | "priority")[];
  onColumnOrderChange: (next: ("title" | "status" | "assignee" | "startDate" | "dueDate" | "priority")[]) => void;
};

export const MilestonesView: React.FC<MilestonesViewProps> = ({
  modules,
  items,
  members,
  onOpenItem,
  onAddMilestoneItem,
  onUpdateItem,
  onOpenModule,
  onMoveItemToModule,
  columnOrder,
  onColumnOrderChange,
}) => {
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );

  const milestoneEntries = useMemo(() => {
    const entries: {
      id: string;
      name: string;
      moduleId: string;
      moduleName: string;
      moduleColor: string;
      itemIds: string[];
    }[] = [];
    modules.forEach((module) => {
      (module.milestones ?? []).forEach((milestone) => {
        entries.push({
          id: milestone.id,
          name: milestone.name,
          moduleId: module.id,
          moduleName: module.name,
          moduleColor: module.color,
          itemIds: milestone.itemIds ?? [],
        });
      });
    });
    return entries;
  }, [modules]);

  const [selectedId, setSelectedId] = useState<string | null>(
    milestoneEntries[0]?.id ?? null
  );

  useEffect(() => {
    if (milestoneEntries.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }
    if (!milestoneEntries.some((entry) => entry.id === selectedId)) {
      setSelectedId(milestoneEntries[0].id);
    }
  }, [milestoneEntries, selectedId]);

  const selectedMilestone = milestoneEntries.find(
    (entry) => entry.id === selectedId
  );

  const selectedItems = useMemo(() => {
    if (!selectedMilestone) return [];
    return selectedMilestone.itemIds
      .map((id) => itemMap.get(id))
      .filter((entry): entry is ItemWithPosition => Boolean(entry));
  }, [itemMap, selectedMilestone]);

  const activeItems = useMemo(
    () => selectedItems.filter((item) => item.status !== "DONE"),
    [selectedItems]
  );

  const completedItems = useMemo(
    () => selectedItems.filter((item) => item.status === "DONE"),
    [selectedItems]
  );

  const modulesWithMilestones = useMemo(
    () =>
      modules.filter(
        (module) => Array.isArray(module.milestones) && module.milestones.length > 0
      ),
    [modules]
  );

  if (modulesWithMilestones.length === 0) {
    return (
      <div className="milestones-view empty">
        <div className="milestones-empty">
          No milestones yet. Add them in a module to start grouping tasks.
        </div>
      </div>
    );
  }

  return (
    <div className="milestones-split">
      <aside className="milestones-sidebar">
        <div className="milestones-sidebar-title">Milestones</div>
        <div className="milestones-sidebar-list">
          {milestoneEntries.map((entry) => (
            <button
              key={entry.id}
              className={`milestone-link ${
                selectedId === entry.id ? "active" : ""
              }`}
              onClick={() => setSelectedId(entry.id)}
            >
              <span
                className="milestones-module-dot"
                style={{ background: entry.moduleColor }}
              />
              <span className="milestone-link-name">{entry.name}</span>
              <span className="milestone-count">{entry.itemIds.length}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="milestones-detail">
        {selectedMilestone ? (
          <>
            <div className="milestone-detail-header">
              <div>
                <div className="milestone-detail-title">
                  {selectedMilestone.name}
                </div>
                <button
                  className="milestone-module-link"
                  onClick={() => onOpenModule(selectedMilestone.moduleId)}
                >
                  {selectedMilestone.moduleName}
                </button>
              </div>
              <div className="milestone-detail-actions">
                <span className="milestone-count">{selectedItems.length}</span>
                <button
                  className="button secondary"
                  onClick={() =>
                    onAddMilestoneItem({
                      moduleId: selectedMilestone.moduleId,
                      milestoneId: selectedMilestone.id,
                    })
                  }
                >
                  Add task
                </button>
              </div>
            </div>
            {selectedItems.length === 0 ? (
              <div className="milestone-empty">No items yet.</div>
            ) : (
              <>
                {activeItems.length === 0 ? (
                  <div className="milestone-empty">No active items yet.</div>
                ) : (
                  <ListView
                    items={activeItems}
                    modules={modules}
                    members={members}
                    onOpenItem={onOpenItem}
                    onUpdateItem={onUpdateItem}
                    onOpenModule={onOpenModule}
                    onMoveItemToModule={onMoveItemToModule}
                    columnOrder={columnOrder}
                    onColumnOrderChange={onColumnOrderChange}
                    title="Milestone tasks"
                    showToolbar
                    scrollable={false}
                  />
                )}
                {completedItems.length > 0 && (
                  <div className="milestones-completed">
                    <div className="milestones-completed-header">
                      Completed tasks
                    </div>
                    <ListView
                      items={completedItems}
                      modules={modules}
                      members={members}
                      onOpenItem={onOpenItem}
                      onUpdateItem={onUpdateItem}
                      onOpenModule={onOpenModule}
                      onMoveItemToModule={onMoveItemToModule}
                      columnOrder={columnOrder}
                      onColumnOrderChange={onColumnOrderChange}
                      showToolbar={false}
                      scrollable={false}
                    />
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <div className="milestone-empty">
            Select a milestone to view its tasks.
          </div>
        )}
      </section>
    </div>
  );
};

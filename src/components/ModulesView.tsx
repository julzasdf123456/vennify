import React, { useEffect, useMemo, useState } from "react";
import { ItemWithPosition, ModuleCircle } from "../types";
import { WorkspaceMember } from "../lib/api";
import { ListView } from "./ListView";

type ModulesViewProps = {
  modules: ModuleCircle[];
  items: ItemWithPosition[];
  members: WorkspaceMember[];
  onUpdateItem: (payload: {
    id: string;
    title?: string;
    status?: string;
    startDate?: string;
    dueDate?: string;
    priority?: string;
    assigneeId?: string | null;
  }) => void;
  onMoveItemToModule: (itemId: string, moduleId: string | null) => void;
  columnOrder: (
    | "title"
    | "status"
    | "assignee"
    | "startDate"
    | "dueDate"
    | "priority"
  )[];
  onColumnOrderChange: (
    next: (
      | "title"
      | "status"
      | "assignee"
      | "startDate"
      | "dueDate"
      | "priority"
    )[]
  ) => void;
  onOpenModule: (id: string) => void;
  onOpenItem: (id: string) => void;
};

export const ModulesView: React.FC<ModulesViewProps> = ({
  modules,
  items,
  members,
  onUpdateItem,
  onMoveItemToModule,
  columnOrder,
  onColumnOrderChange,
  onOpenModule,
  onOpenItem,
}) => {
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );
  const [showCompleted, setShowCompleted] = useState(false);

  const [openModuleIds, setOpenModuleIds] = useState<Record<string, boolean>>(
    {}
  );
  const [openMilestoneIds, setOpenMilestoneIds] = useState<
    Record<string, boolean>
  >({});
  const allExpanded = useMemo(() => {
    if (modules.length === 0) return false;
    const moduleExpanded = modules.every((module) => openModuleIds[module.id]);
    const milestoneKeys = modules.flatMap((module) =>
      (module.milestones ?? []).map((milestone) => `${module.id}::${milestone.id}`)
    );
    const milestoneExpanded = milestoneKeys.every((key) => openMilestoneIds[key]);
    return moduleExpanded && milestoneExpanded;
  }, [modules, openModuleIds, openMilestoneIds]);

  const toggleExpandAll = () => {
    const nextExpanded = !allExpanded;
    const nextModuleState: Record<string, boolean> = {};
    const nextMilestoneState: Record<string, boolean> = {};

    modules.forEach((module) => {
      nextModuleState[module.id] = nextExpanded;
      (module.milestones ?? []).forEach((milestone) => {
        nextMilestoneState[`${module.id}::${milestone.id}`] = nextExpanded;
      });
    });

    setOpenModuleIds(nextModuleState);
    setOpenMilestoneIds(nextMilestoneState);
  };

  useEffect(() => {
    if (modules.length === 0) {
      setOpenModuleIds({});
      return;
    }
    setOpenModuleIds((prev) => {
      const next: Record<string, boolean> = {};
      modules.forEach((module, index) => {
        next[module.id] = prev[module.id] ?? index === 0;
      });
      return next;
    });
  }, [modules]);

  useEffect(() => {
    setOpenMilestoneIds((prev) => {
      const validIds: string[] = modules.flatMap((module) =>
        (module.milestones ?? []).map((milestone) => `${module.id}::${milestone.id}`)
      );
      const next: Record<string, boolean> = {};
      validIds.forEach((key) => {
        next[key] = prev[key] ?? true;
      });
      return next;
    });
  }, [modules]);

  if (modules.length === 0) {
    return (
      <section className="view-panel">
        <div className="modules-empty">No modules yet. Add a module in Venn view.</div>
      </section>
    );
  }

  return (
    <section className="view-panel modules-view">
      <div className="modules-view-header-row">
        <div className="modules-view-header">Modules</div>
        <div className="modules-view-controls">
          <button
            type="button"
            className={`modules-completed-toggle modules-expand-toggle ${
              allExpanded ? "on" : "off"
            }`}
            onClick={toggleExpandAll}
            role="switch"
            aria-checked={allExpanded}
            aria-label="Toggle expand all"
          >
            <span className="modules-toggle-text">
              {allExpanded ? "Collapse all" : "Expand all"}
            </span>
            <span className="modules-toggle-track" aria-hidden="true">
              <span className="modules-toggle-thumb" />
            </span>
          </button>
          <button
            type="button"
            className={`modules-completed-toggle ${showCompleted ? "on" : "off"}`}
            onClick={() => setShowCompleted((prev) => !prev)}
            role="switch"
            aria-checked={showCompleted}
            aria-label="Toggle completed tasks"
          >
            <span className="modules-toggle-text">Show completed</span>
            <span className="modules-toggle-track" aria-hidden="true">
              <span className="modules-toggle-thumb" />
            </span>
          </button>
        </div>
      </div>
      <div className="modules-accordion">
        {modules.map((module) => {
          const milestones = module.milestones ?? [];
          const isModuleOpen = !!openModuleIds[module.id];
          const moduleItems = items.filter(
            (entry) => (entry.ownerModuleId ?? null) === module.id
          );
          const visibleModuleItems = moduleItems.filter(
            (entry) => showCompleted || entry.status !== "DONE"
          );
          return (
            <article key={module.id} className="module-accordion-item">
              <div className="module-accordion-row">
                <button
                  className="module-accordion-toggle"
                  onClick={() =>
                    setOpenModuleIds((prev) => ({
                      ...prev,
                      [module.id]: !prev[module.id],
                    }))
                  }
                  aria-expanded={isModuleOpen}
                  >
                    <span
                      className={`module-accordion-chevron ${
                        isModuleOpen ? "open" : ""
                      }`}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 16 16">
                      <path
                        d="M6 3.5l4 4.5-4 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                    <span
                      className="module-accordion-dot"
                      style={{ background: module.color }}
                    />
                </button>
                <button
                  className="module-accordion-name module-name-pill module-name-button"
                  style={{
                    background: `${module.color}2a`,
                    borderColor: `${module.color}66`,
                  }}
                  onClick={() => onOpenModule(module.id)}
                >
                  {module.name}
                </button>
                <span className="module-accordion-count">{milestones.length}</span>
              </div>

              {isModuleOpen && (
                <div className="milestone-accordion">
                  {milestones.length === 0 && (
                    <div className="module-task-list">
                      {visibleModuleItems.length > 0 && (
                        <ListView
                          items={visibleModuleItems}
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
                          flat
                        />
                      )}
                    </div>
                  )}
                  {milestones.map((milestone) => {
                    const milestoneKey = `${module.id}::${milestone.id}`;
                    const isMilestoneOpen = !!openMilestoneIds[milestoneKey];
                    const milestoneItems = (milestone.itemIds ?? [])
                      .map((id) => itemMap.get(id))
                      .filter((entry): entry is ItemWithPosition => Boolean(entry));
                    const visibleMilestoneItems = milestoneItems.filter(
                      (entry) => showCompleted || entry.status !== "DONE"
                    );

                    return (
                      <div key={milestone.id} className="milestone-accordion-item">
                        <button
                          className="milestone-accordion-toggle"
                          onClick={() =>
                            setOpenMilestoneIds((prev) => ({
                              ...prev,
                              [milestoneKey]: !prev[milestoneKey],
                            }))
                          }
                          aria-expanded={isMilestoneOpen}
                        >
                          <span
                            className={`milestone-accordion-chevron ${
                              isMilestoneOpen ? "open" : ""
                            }`}
                            aria-hidden="true"
                          >
                            <svg viewBox="0 0 16 16">
                              <path
                                d="M6 3.5l4 4.5-4 4.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="milestone-accordion-name">
                            {milestone.name}
                          </span>
                          <span className="milestone-accordion-count">
                            {visibleMilestoneItems.length}
                          </span>
                        </button>

                        {isMilestoneOpen && (
                          <div className="module-task-list">
                            {visibleMilestoneItems.length === 0 && (
                              <div className="modules-muted-row">
                                No tasks in this milestone.
                              </div>
                            )}
                            {visibleMilestoneItems.length > 0 && (
                              <ListView
                                items={visibleMilestoneItems}
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
                                flat
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};

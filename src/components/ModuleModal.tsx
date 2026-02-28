import React, { useEffect, useMemo, useRef, useState } from "react";
import { ItemWithPosition, ModuleCircle } from "../types";
import { distance } from "../lib/geometry";

type ModuleModalProps = {
  open: boolean;
  module: ModuleCircle | null;
  modules: ModuleCircle[];
  items: ItemWithPosition[];
  onClose: () => void;
  onSave: (payload: ModuleCircle) => void;
};

const SHAPE_OPTIONS: { value: ModuleCircle["shape"]; label: string }[] = [
  { value: "solid", label: "Circle (solid)" },
  { value: "outline", label: "Circle (outline)" },
  { value: "dashed", label: "Circle (dashed)" },
  { value: "square", label: "Square" },
  { value: "diamond", label: "Diamond" },
];

export const ModuleModal: React.FC<ModuleModalProps> = ({
  open,
  module,
  modules,
  items,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState<ModuleCircle | null>(module);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastSnapshotRef = useRef<string>("");

  const connectedModules = useMemo(() => {
    if (!module) return [];
    return modules.filter((entry) => {
      if (entry.id === module.id) return false;
      return (
        distance({ x: module.x, y: module.y }, { x: entry.x, y: entry.y }) <=
        module.radius + entry.radius
      );
    });
  }, [module, modules]);

  const moduleItems = useMemo(() => {
    if (!module) return [];
    return items.filter((item) => item.ownerModuleId === module.id);
  }, [items, module?.id]);

  useEffect(() => {
    if (!open || !module) return;
    if (draft?.id === module.id) return;
    const nextDraft: ModuleCircle = {
      ...module,
      description: module.description ?? "",
      shape: (module.shape as ModuleCircle["shape"]) ?? "solid",
      milestones: Array.isArray(module.milestones) ? module.milestones : [],
    };
    setDraft(nextDraft);
    setSaving(false);
    lastSnapshotRef.current = JSON.stringify({
      id: module.id,
      name: module.name.trim(),
      description: module.description ?? "",
      color: module.color,
      shape: module.shape ?? "solid",
      milestones: Array.isArray(module.milestones) ? module.milestones : [],
    });
  }, [open, module?.id]);

  useEffect(() => {
    if (!open || !draft) return () => undefined;
    if (!draft.name.trim()) return () => undefined;

    const nextSnapshot = JSON.stringify({
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description ?? "",
      color: draft.color,
      shape: draft.shape ?? "solid",
      milestones: draft.milestones ?? [],
    });

    if (nextSnapshot === lastSnapshotRef.current) {
      return () => undefined;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      setSaving(true);
      const payload: ModuleCircle = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description ?? "",
        shape: draft.shape ?? "solid",
        milestones: draft.milestones ?? [],
      };
      onSave(payload);
      lastSnapshotRef.current = nextSnapshot;
      setSaving(false);
    }, 600);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [open, draft, onSave]);

  if (!open || !draft) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal module-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Module details"
        onClick={(evt) => evt.stopPropagation()}
      >
        <div className="item-modal-header">
          <div className="item-modal-title">
            <div className="header-eyebrow">Module</div>
            <input
              className="item-title-input"
              value={draft.name}
              onChange={(evt) =>
                setDraft((prev) =>
                  prev ? { ...prev, name: evt.target.value } : prev
                )
              }
            />
          </div>
          <div className="item-modal-actions">
            <button className="button secondary header-btn" onClick={onClose}>
              Close
            </button>
            {saving && (
              <div className="item-save-indicator">Autosaving...</div>
            )}
          </div>
        </div>

        <div className="module-modal-body">
          <div className="module-modal-main">
            <label className="field-label" htmlFor="module-description">
              Description
            </label>
            <textarea
              id="module-description"
              className="text-input text-area"
              placeholder="Add context for this module"
              value={draft.description}
              onChange={(evt) =>
                setDraft((prev) =>
                  prev ? { ...prev, description: evt.target.value } : prev
                )
              }
            />

            <div className="item-field-grid">
              <div className="item-field">
                <span>Color</span>
                <input
                  className="text-input color-input"
                  type="color"
                  value={draft.color}
                  onChange={(evt) =>
                    setDraft((prev) =>
                      prev ? { ...prev, color: evt.target.value } : prev
                    )
                  }
                />
                <div className="field-helper">{draft.color}</div>
              </div>
              <div className="item-field">
                <span>Shape</span>
                <select
                  className="text-input"
                  value={draft.shape}
                  onChange={(evt) =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            shape: evt.target.value as ModuleCircle["shape"],
                          }
                        : prev
                    )
                  }
                >
                  {SHAPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="item-field">
                <span>Created</span>
                <div className="field-helper">
                  {draft.createdAt
                    ? new Date(draft.createdAt).toLocaleString()
                    : "Not saved yet"}
                </div>
              </div>
            </div>

            <div className="milestones-section">
              <div className="milestones-header">
                <h4>Milestones</h4>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    setDraft((prev) => {
                      if (!prev) return prev;
                      const next = prev.milestones ?? [];
                      return {
                        ...prev,
                        milestones: [
                          ...next,
                          {
                            id: crypto.randomUUID(),
                            name: `Milestone ${next.length + 1}`,
                            itemIds: [],
                          },
                        ],
                      };
                    })
                  }
                >
                  Add milestone
                </button>
              </div>
              {(draft.milestones ?? []).length === 0 && (
                <div className="custom-fields-empty">
                  No milestones yet. Add one to group related tasks.
                </div>
              )}
              {(draft.milestones ?? []).map((milestone) => (
                <div key={milestone.id} className="milestone-card">
                  <div className="milestone-title-row">
                    <input
                      className="text-input"
                      value={milestone.name}
                      onChange={(evt) =>
                        setDraft((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            milestones: (prev.milestones ?? []).map((entry) =>
                              entry.id === milestone.id
                                ? { ...entry, name: evt.target.value }
                                : entry
                            ),
                          };
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() =>
                        setDraft((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            milestones: (prev.milestones ?? []).filter(
                              (entry) => entry.id !== milestone.id
                            ),
                          };
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                  <div className="milestone-items">
                    {moduleItems.length === 0 && (
                      <div className="custom-fields-empty">
                        No items in this module yet.
                      </div>
                    )}
                    {moduleItems.map((item) => (
                      <label key={item.id} className="relation-row">
                        <input
                          type="checkbox"
                          checked={milestone.itemIds.includes(item.id)}
                          onChange={(evt) =>
                            setDraft((prev) => {
                              if (!prev) return prev;
                              const milestones = prev.milestones ?? [];
                              return {
                                ...prev,
                                milestones: milestones.map((entry) => {
                                  if (entry.id !== milestone.id) return entry;
                                  const itemIds = entry.itemIds ?? [];
                                  if (evt.target.checked) {
                                    return {
                                      ...entry,
                                      itemIds: [...itemIds, item.id],
                                    };
                                  }
                                  return {
                                    ...entry,
                                    itemIds: itemIds.filter((id) => id !== item.id),
                                  };
                                }),
                              };
                            })
                          }
                        />
                        <span>{item.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="module-modal-aside">
            <div className="activity-header">Connected Modules</div>
            {connectedModules.length === 0 && (
              <div className="custom-fields-empty">
                No overlaps with other modules.
              </div>
            )}
            <div className="connected-modules-list">
              {connectedModules.map((entry) => (
                <div key={entry.id} className="connected-module-row">
                  <span
                    className="connected-module-dot"
                    style={{ background: entry.color }}
                  />
                  <span>{entry.name}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

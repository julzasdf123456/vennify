import React, { useEffect, useMemo, useRef, useState } from "react";
import { ItemWithPosition, ModuleCircle } from "../types";
import {
  addItemComment,
  fetchItemActivity,
  fetchItemComments,
  ItemActivity,
  ItemComment,
  WorkspaceMember,
} from "../lib/api";

type ItemModalProps = {
  open: boolean;
  item: ItemWithPosition | null;
  modules: ModuleCircle[];
  members: WorkspaceMember[];
  workspaceId: string | null;
  projectSlug: string;
  onClose: () => void;
  onSave: (payload: {
    item: ItemWithPosition;
    assigneeId: string | null;
    customFields: { key: string; value: string }[];
    relatedItemIds: string[];
  }) => Promise<void>;
  onAddToMilestone: (payload: {
    itemId: string;
    moduleId: string;
    milestoneId: string;
  }) => ItemWithPosition | null;
  onDelete: (itemId: string) => Promise<void>;
};

type CustomFieldDraft = {
  id: string;
  key: string;
  value: string;
};

const STATUS_OPTIONS = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "REVIEW",
  "ROADBLOCKED",
  "DONE",
];

const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const ICON_OPTIONS = [
  { value: "", label: "None" },
  { value: "🧩", label: "Feature" },
  { value: "⚙️", label: "Task" },
  { value: "🐞", label: "Bug" },
  { value: "📌", label: "Pin" },
  { value: "✅", label: "Done" },
  { value: "📝", label: "Note" },
  { value: "🔗", label: "Link" },
  { value: "🧪", label: "Test" },
  { value: "🚀", label: "Launch" },
];

const statusClass = (status: string) =>
  `status-${status.toLowerCase().replace(/_/g, "-")}`;

const makeFieldId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

const formatActivity = (entry: ItemActivity) => {
  if (entry.action === "ITEM_CREATED") {
    return "Created this item";
  }
  if (entry.action === "ITEM_DELETED") {
    return "Deleted this item";
  }
  if (entry.action === "COMMENT_ADDED") {
    return "Added a comment";
  }
  if (entry.action === "ITEM_UPDATED") {
    const changes = (entry.meta?.changes ?? []) as {
      field: string;
      from: unknown;
      to: unknown;
    }[];
    if (changes.length === 0) return "Updated item";
    const fields = changes.map((change) => change.field).join(", ");
    return `Updated: ${fields}`;
  }
  return "Activity";
};

export const ItemModal: React.FC<ItemModalProps> = ({
  open,
  item,
  modules,
  members,
  workspaceId,
  projectSlug,
  onClose,
  onSave,
  onAddToMilestone,
  onDelete,
}) => {
  const [draft, setDraft] = useState<ItemWithPosition | null>(item);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>([]);
  const [relatedItemIds, setRelatedItemIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [comments, setComments] = useState<ItemComment[]>([]);
  const [activity, setActivity] = useState<ItemActivity[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showMilestonePicker, setShowMilestonePicker] = useState(false);
  const [selectedMilestoneKey, setSelectedMilestoneKey] = useState("");
  const saveTimerRef = useRef<number | null>(null);
  const lastSavedSnapshotRef = useRef<string>("");

  const milestoneOptions = useMemo(() => {
    const options: {
      key: string;
      moduleId: string;
      moduleName: string;
      milestoneId: string;
      milestoneName: string;
    }[] = [];
    modules.forEach((module) => {
      (module.milestones ?? []).forEach((milestone) => {
        options.push({
          key: `${module.id}::${milestone.id}`,
          moduleId: module.id,
          moduleName: module.name,
          milestoneId: milestone.id,
          milestoneName: milestone.name,
        });
      });
    });
    return options;
  }, [modules]);

  const currentMilestones = useMemo(() => {
    if (!item) return [];
    const entries: { id: string; label: string; color: string }[] = [];
    modules.forEach((module) => {
      (module.milestones ?? []).forEach((milestone) => {
        if (milestone.itemIds?.includes(item.id)) {
          entries.push({
            id: `${module.id}::${milestone.id}`,
            label: `${module.name} · ${milestone.name}`,
            color: module.color,
          });
        }
      });
    });
    return entries;
  }, [modules, item]);

  const refreshSidePanel = async () => {
    if (!workspaceId || !item) return;
    setLoading(true);
    try {
      const [nextComments, nextActivity] = await Promise.all([
        fetchItemComments(workspaceId, projectSlug, item.id),
        fetchItemActivity(workspaceId, projectSlug, item.id),
      ]);
      setComments(nextComments);
      setActivity(nextActivity);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !item) return;
    if (draft?.id === item.id) return;
    setDraft(item);
    setAssigneeId(item.assigneeIds?.[0] ?? null);
    setCustomFields(
      (item.customFields ?? []).map((field) => ({
        id: makeFieldId(),
        key: field.key,
        value: field.value,
      }))
    );
    setRelatedItemIds(item.relatedItemIds ?? []);
    setSaving(false);
    setCommentDraft("");
    setShowAllActivity(false);
    setShowMilestonePicker(false);
    lastSavedSnapshotRef.current = JSON.stringify({
      id: item.id,
      title: item.title.trim(),
      description: item.description ?? "",
      status: item.status,
      priority: item.priority,
      icon: item.icon ?? null,
      color: item.color ?? null,
      startDate: item.startDate ?? null,
      dueDate: item.dueDate ?? null,
      assigneeId: item.assigneeIds?.[0] ?? null,
      customFields: item.customFields ?? [],
      relatedItemIds: item.relatedItemIds ?? [],
    });
    if (workspaceId) {
      refreshSidePanel();
    }
  }, [open, item?.id, workspaceId]);

  useEffect(() => {
    if (!showMilestonePicker) return;
    if (milestoneOptions.length === 0) {
      setSelectedMilestoneKey("");
      return;
    }
    if (!milestoneOptions.some((option) => option.key === selectedMilestoneKey)) {
      setSelectedMilestoneKey(milestoneOptions[0].key);
    }
  }, [showMilestonePicker, milestoneOptions, selectedMilestoneKey]);

  useEffect(() => {
    if (!open || !draft) return () => undefined;
    if (!draft.title.trim()) return () => undefined;

    const nextSnapshot = JSON.stringify({
      id: draft.id,
      title: draft.title.trim(),
      description: draft.description ?? "",
      status: draft.status,
      priority: draft.priority,
      icon: draft.icon ?? null,
      color: draft.color ?? null,
      startDate: draft.startDate ?? null,
      dueDate: draft.dueDate ?? null,
      assigneeId,
      customFields: customFields.map(({ key, value }) => ({ key, value })),
      relatedItemIds,
    });

    if (nextSnapshot === lastSavedSnapshotRef.current) {
      return () => undefined;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(async () => {
      setSaving(true);
      await onSave({
        item: { ...draft, title: draft.title.trim() },
        assigneeId,
        customFields: customFields.map(({ key, value }) => ({ key, value })),
        relatedItemIds,
      });
      lastSavedSnapshotRef.current = nextSnapshot;
      setSaving(false);
      await refreshSidePanel();
    }, 600);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [open, draft, assigneeId, customFields, relatedItemIds, onSave]);

  if (!open || !draft) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal item-modal redesigned"
        role="dialog"
        aria-modal="true"
        aria-label="Item details"
        onClick={(evt) => evt.stopPropagation()}
      >
        <div className="item-modal-header">
          <div className="item-modal-title">
            <div className="header-eyebrow">Task</div>
            <input
              className="item-title-input"
              value={draft.title}
              onChange={(evt) =>
                setDraft((prev) =>
                  prev ? { ...prev, title: evt.target.value } : prev
                )
              }
            />
          </div>
          <div className="item-modal-actions">
            <button
              className="icon-btn modal-icon-btn"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              ×
            </button>
            {saving && (
              <div className="item-save-indicator">Autosaving...</div>
            )}
            <button
              className="icon-btn modal-icon-btn danger"
              onClick={async () => {
                await onDelete(draft.id);
                onClose();
              }}
              aria-label="Delete"
              title="Delete"
            >
              🗑
            </button>
          </div>
        </div>

        <div className="item-modal-body">
          <div className="item-modal-main">
            <label className="field-label" htmlFor="item-description">
              Description
            </label>
            <textarea
              id="item-description"
              className="text-input text-area"
              placeholder="Add a description or summary"
              value={draft.description}
              onChange={(evt) =>
                setDraft((prev) =>
                  prev ? { ...prev, description: evt.target.value } : prev
                )
              }
            />

            <div className="item-field-grid">
              <div className="item-field">
                <span>Status</span>
                <select
                  className={`text-input status-select ${statusClass(draft.status)}`}
                  value={draft.status}
                  onChange={(evt) =>
                    setDraft((prev) =>
                      prev ? { ...prev, status: evt.target.value } : prev
                    )
                  }
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option.toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="item-field">
                <span>Priority</span>
                <select
                  className="text-input"
                  value={draft.priority}
                  onChange={(evt) =>
                    setDraft((prev) =>
                      prev ? { ...prev, priority: evt.target.value } : prev
                    )
                  }
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option.toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="item-field">
                <span>Icon</span>
                <select
                  className="text-input"
                  value={draft.icon ?? ""}
                  onChange={(evt) =>
                    setDraft((prev) =>
                      prev ? { ...prev, icon: evt.target.value || null } : prev
                    )
                  }
                >
                  {ICON_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.value ? `${option.value} ${option.label}` : option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="item-field">
                <span>Assignee</span>
                <select
                  className="text-input"
                  value={assigneeId ?? ""}
                  onChange={(evt) => setAssigneeId(evt.target.value || null)}
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name ?? member.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="item-field">
                <span>Color</span>
                <input
                  className="text-input color-input"
                  type="color"
                  value={draft.color ?? "#6b7cff"}
                  onChange={(evt) =>
                    setDraft((prev) =>
                      prev ? { ...prev, color: evt.target.value } : prev
                    )
                  }
                />
                <div className="field-helper">
                  {draft.color ?? "Default"}
                </div>
              </div>
              <div className="item-field">
                <span>Start date</span>
                <input
                  className="text-input"
                  type="date"
                  value={draft.startDate ? draft.startDate.slice(0, 10) : ""}
                  onChange={(evt) =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            startDate: evt.target.value
                              ? new Date(evt.target.value).toISOString()
                              : undefined,
                          }
                        : prev
                    )
                  }
                />
              </div>
              <div className="item-field">
                <span>Due date</span>
                <input
                  className="text-input"
                  type="date"
                  value={draft.dueDate ? draft.dueDate.slice(0, 10) : ""}
                  onChange={(evt) =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            dueDate: evt.target.value
                              ? new Date(evt.target.value).toISOString()
                              : undefined,
                          }
                        : prev
                    )
                  }
                />
              </div>
            </div>

            <div className="custom-fields">
              <div className="custom-fields-header">
                <h4>Custom fields</h4>
                <button
                  type="button"
                  className="button secondary header-btn"
                  onClick={() =>
                    setCustomFields((prev) => [
                      ...prev,
                      { id: makeFieldId(), key: "", value: "" },
                    ])
                  }
                >
                  Add field
                </button>
              </div>
              {customFields.length === 0 && (
                <div className="custom-fields-empty">
                  Add notes or metadata for this item.
                </div>
              )}
              {customFields.map((field, index) => (
                <div key={field.id} className="custom-field-row">
                  <input
                    className="text-input"
                    placeholder="Label"
                    value={field.key}
                    onChange={(evt) =>
                      setCustomFields((prev) =>
                        prev.map((entry, idx) =>
                          idx === index
                            ? { ...entry, key: evt.target.value }
                            : entry
                        )
                      )
                    }
                  />
                  <input
                    className="text-input"
                    placeholder="Value"
                    value={field.value}
                    onChange={(evt) =>
                      setCustomFields((prev) =>
                        prev.map((entry, idx) =>
                          idx === index
                            ? { ...entry, value: evt.target.value }
                            : entry
                        )
                      )
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() =>
                      setCustomFields((prev) =>
                        prev.filter((_entry, idx) => idx !== index)
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="custom-fields">
              <div className="custom-fields-header">
                <h4>Milestones</h4>
                <button
                  type="button"
                  className="button secondary header-btn"
                  onClick={() => setShowMilestonePicker(true)}
                  disabled={draft.status === "DONE"}
                  title={
                    draft.status === "DONE"
                      ? "Completed items can't be added to milestones."
                      : "Add to milestone"
                  }
                >
                  Add to milestone
                </button>
              </div>
              {currentMilestones.length === 0 && (
                <div className="custom-fields-empty">
                  Not assigned to any milestone yet.
                </div>
              )}
              {currentMilestones.length > 0 && (
                <div className="milestone-tags">
                  {currentMilestones.map((entry) => (
                    <span
                      key={entry.id}
                      className="milestone-tag"
                      style={{ background: entry.color }}
                    >
                      {entry.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

          </div>

          <aside className="item-modal-aside">
            <div className="activity-section">
              <div className="activity-header">Activity</div>
              {loading && <div className="custom-fields-empty">Loading...</div>}
              {!loading && activity.length === 0 && (
                <div className="custom-fields-empty">No activity yet.</div>
              )}
              <div className="activity-list">
                {(showAllActivity ? activity : activity.slice(0, 5)).map(
                  (entry) => (
                  <div key={entry.id} className="activity-row">
                    <div className="activity-title">
                      {entry.actor.name ?? entry.actor.email}
                    </div>
                    <div className="activity-meta">{formatActivity(entry)}</div>
                    <div className="activity-time">
                      {new Date(entry.createdAt).toLocaleString()}
                    </div>
                  </div>
                  )
                )}
              </div>
              {activity.length > 5 && (
                <button
                  type="button"
                  className="button secondary header-btn"
                  onClick={() => setShowAllActivity((prev) => !prev)}
                >
                  {showAllActivity ? "Show less" : "Show more"}
                </button>
              )}
            </div>

            <div className="comments-section">
              <div className="activity-header">Comments</div>
              <div className="comments-list">
                {comments.map((comment) => (
                  <div key={comment.id} className="comment-row">
                    <div className="comment-author">
                      {comment.user.name ?? comment.user.email}
                    </div>
                    <div className="comment-body">{comment.body}</div>
                    <div className="comment-time">
                      {new Date(comment.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
                {comments.length === 0 && (
                  <div className="custom-fields-empty">No comments yet.</div>
                )}
              </div>
              <div className="comment-composer">
                <textarea
                  className="text-input text-area"
                  placeholder="Write a comment..."
                  value={commentDraft}
                  onChange={(evt) => setCommentDraft(evt.target.value)}
                />
                <button
                  className="button"
                  onClick={async () => {
                    if (!workspaceId || !item) return;
                    if (!commentDraft.trim()) return;
                    const comment = await addItemComment(
                      workspaceId,
                      projectSlug,
                      item.id,
                      commentDraft.trim()
                    );
                    setComments((prev) => [...prev, comment]);
                    setCommentDraft("");
                    await refreshSidePanel();
                  }}
                >
                  Comment
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
      {showMilestonePicker && (
        <div
          className="submodal-backdrop"
          onClick={(evt) => {
            evt.stopPropagation();
            setShowMilestonePicker(false);
          }}
        >
          <div
            className="submodal"
            role="dialog"
            aria-modal="true"
            aria-label="Add to milestone"
            onClick={(evt) => evt.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Add to milestone</h3>
            </div>
            {draft.status === "DONE" ? (
              <p className="modal-subtitle">
                Completed items can't be added to milestones.
              </p>
            ) : milestoneOptions.length === 0 ? (
              <p className="modal-subtitle">
                Create a milestone inside a module first.
              </p>
            ) : (
              <>
                <label className="field-label" htmlFor="milestone-select">
                  Milestone
                </label>
                <select
                  id="milestone-select"
                  className="text-input"
                  value={selectedMilestoneKey}
                  onChange={(evt) => setSelectedMilestoneKey(evt.target.value)}
                >
                  {milestoneOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.moduleName} · {option.milestoneName}
                    </option>
                  ))}
                </select>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setShowMilestonePicker(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={draft.status === "DONE" || !selectedMilestoneKey}
                    onClick={() => {
                      if (!selectedMilestoneKey || !draft) return;
                      const [moduleId, milestoneId] =
                        selectedMilestoneKey.split("::");
                      if (!moduleId || !milestoneId) return;
                      const updated = onAddToMilestone({
                        itemId: draft.id,
                        moduleId,
                        milestoneId,
                      });
                      if (updated) {
                        setDraft(updated);
                        setRelatedItemIds(updated.relatedItemIds ?? []);
                      }
                      setShowMilestonePicker(false);
                    }}
                  >
                    Add
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

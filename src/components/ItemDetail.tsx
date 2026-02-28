import React from "react";
import { ItemWithPosition, Membership, ModuleCircle } from "../types";

export type ItemDetailProps = {
  item: ItemWithPosition | null;
  memberships: Membership[];
  modules: ModuleCircle[];
};

export const ItemDetail: React.FC<ItemDetailProps> = ({
  item,
  memberships,
  modules,
}) => {
  if (!item) {
    return (
      <div className="detail-card">
        <p>Select an item to see details.</p>
      </div>
    );
  }

  const membership = memberships.find((entry) => entry.itemId === item.id);
  const moduleNames = (membership?.moduleIds ?? [])
    .map((id) => modules.find((module) => module.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="detail-card">
      <div className="title" style={{ fontWeight: 600 }}>
        {item.title}
      </div>
      <div
        className={`status-pill status-${item.status
          .toLowerCase()
          .replace(/_/g, "-")}`}
        style={{ marginTop: 6, display: "inline-block" }}
      >
        {item.status}
      </div>
      <p>{item.description}</p>
      <p>Priority: {item.priority}</p>
      <p>Due: {item.dueDate ?? "Unset"}</p>
      <div className="badges">
        {moduleNames.length > 0 ? (
          moduleNames.map((name) => (
            <span key={name} className="badge">
              {name}
            </span>
          ))
        ) : (
          <span className="badge">Unassigned</span>
        )}
      </div>
    </div>
  );
};

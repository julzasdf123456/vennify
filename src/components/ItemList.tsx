import React from "react";
import { ItemWithPosition, Membership, ModuleCircle } from "../types";

export type ItemListProps = {
  items: ItemWithPosition[];
  memberships: Membership[];
  modules: ModuleCircle[];
  selectedItemId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
};

export const ItemList: React.FC<ItemListProps> = ({
  items,
  memberships,
  modules,
  selectedItemId,
  onSelect,
  onOpen,
}) => {
  const moduleMap = new Map(modules.map((module) => [module.id, module]));
  const membershipMap = new Map(
    memberships.map((membership) => [membership.itemId, membership.moduleIds])
  );
  const statusClass = (status: string) =>
    `status-${status.toLowerCase().replace(/_/g, "-")}`;
  const statusLabel = (status: string) =>
    status
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^\w/, (char) => char.toUpperCase());

  return (
    <div className="item-list">
      {items.map((item) => {
        const moduleNames = (membershipMap.get(item.id) ?? [])
          .map((id) => moduleMap.get(id)?.name)
          .filter(Boolean)
          .join(" · ");

        return (
          <div
            key={item.id}
            className={`item-row ${selectedItemId === item.id ? "active" : ""}`}
            onClick={() => {
              onSelect(item.id);
              onOpen(item.id);
            }}
          >
            <div className="title">{item.title}</div>
            <div className="meta">
              <span className={`status-pill ${statusClass(item.status)}`}>
                {statusLabel(item.status)}
              </span>
              <span className="meta-divider">·</span>
              <span>{item.priority.toLowerCase()}</span>
            </div>
            <div className="meta">
              {moduleNames.length > 0 ? moduleNames : "Unassigned"}
            </div>
          </div>
        );
      })}
    </div>
  );
};

import React, { useMemo, useState } from "react";
import { ItemWithPosition } from "../types";

type CalendarViewProps = {
  items: ItemWithPosition[];
  onOpenItem: (id: string) => void;
};

const monthLabel = (date: Date) =>
  date.toLocaleDateString(undefined, { month: "long", year: "numeric" });

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

const parseDateOnly = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const toUtcDay = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

const dayDiff = (start: Date, end: Date) =>
  Math.round((toUtcDay(end) - toUtcDay(start)) / (24 * 60 * 60 * 1000));

export const CalendarView: React.FC<CalendarViewProps> = ({
  items,
  onOpenItem,
}) => {
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();
  const startOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = startOfMonth.getDay();
  const visibleItems = useMemo(
    () => items.filter((item) => item.status !== "DONE"),
    [items]
  );

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ItemWithPosition[]>();
    visibleItems.forEach((item) => {
      const start = parseDateOnly(item.startDate ?? item.dueDate);
      const end = parseDateOnly(item.dueDate ?? item.startDate);
      if (!start || !end) return;
      if (dayDiff(start, end) > 0) return;
      const key = dateKey(start);
      const existing = map.get(key) ?? [];
      existing.push(item);
      map.set(key, existing);
    });
    return map;
  }, [visibleItems]);

  const cells = useMemo(() => {
    const result: { date: Date; inMonth: boolean }[] = [];
    let day = 1 - startOffset;
    for (let i = 0; i < 42; i += 1) {
      const cellDate = new Date(year, month, day);
      result.push({ date: cellDate, inMonth: cellDate.getMonth() === month });
      day += 1;
    }
    return result;
  }, [year, month, startOffset]);

  const spanItems = useMemo(() => {
    if (cells.length === 0) return { segments: [], maxLanes: 0 };
    const gridStart = new Date(
      cells[0].date.getFullYear(),
      cells[0].date.getMonth(),
      cells[0].date.getDate()
    );
    const gridEnd = new Date(
      cells[cells.length - 1].date.getFullYear(),
      cells[cells.length - 1].date.getMonth(),
      cells[cells.length - 1].date.getDate()
    );
    const segments: {
      id: string;
      title: string;
      row: number;
      col: number;
      span: number;
      lane: number;
    }[] = [];

    visibleItems.forEach((item) => {
      const start = parseDateOnly(item.startDate ?? item.dueDate);
      const end = parseDateOnly(item.dueDate ?? item.startDate);
      if (!start || !end) return;
      if (dayDiff(start, end) <= 0) return;
      const rangeStart = start < gridStart ? gridStart : start;
      const rangeEnd = end > gridEnd ? gridEnd : end;
      if (rangeEnd < rangeStart) return;

      let startIndex = dayDiff(gridStart, rangeStart);
      const endIndex = dayDiff(gridStart, rangeEnd);
      while (startIndex <= endIndex) {
        const row = Math.floor(startIndex / 7);
        const rowEnd = Math.min(endIndex, row * 7 + 6);
        const span = rowEnd - startIndex + 1;
        const col = (startIndex % 7) + 1;
        segments.push({
          id: item.id,
          title: item.title,
          row: row + 1,
          col,
          span,
          lane: 0,
        });
        startIndex = rowEnd + 1;
      }
    });

    const laneMap = new Map<number, { start: number; end: number }[][]>();
    let maxLanes = 0;
    const withLanes = segments.map((segment) => {
      const rowKey = segment.row;
      const lanes = laneMap.get(rowKey) ?? [];
      const range = { start: segment.col, end: segment.col + segment.span - 1 };
      let laneIndex = lanes.findIndex((lane) =>
        lane.every((entry) => entry.end < range.start || entry.start > range.end)
      );
      if (laneIndex === -1) {
        laneIndex = lanes.length;
        lanes.push([]);
      }
      lanes[laneIndex].push(range);
      laneMap.set(rowKey, lanes);
      maxLanes = Math.max(maxLanes, lanes.length);
      return { ...segment, lane: laneIndex };
    });

    return { segments: withLanes, maxLanes };
  }, [cells, visibleItems]);

  const rowTemplate = useMemo(() => {
    if (cells.length === 0) return "";
    const rowMeta = Array.from({ length: 6 }, () => ({
      hasItems: false,
      maxItems: 0,
      maxLanes: 0,
    }));
    cells.forEach((cell, index) => {
      const key = dateKey(cell.date);
      const hasItems = (itemsByDate.get(key)?.length ?? 0) > 0;
      const rowIndex = Math.floor(index / 7);
      if (hasItems) {
        rowMeta[rowIndex].hasItems = true;
      }
      const count = itemsByDate.get(key)?.length ?? 0;
      if (count > rowMeta[rowIndex].maxItems) {
        rowMeta[rowIndex].maxItems = count;
      }
    });
    spanItems.segments.forEach((segment) => {
      const rowIndex = segment.row - 1;
      rowMeta[rowIndex].hasItems = true;
      rowMeta[rowIndex].maxLanes = Math.max(
        rowMeta[rowIndex].maxLanes,
        segment.lane + 1
      );
    });
    const LANE_HEIGHT = 18;
    const ITEM_HEIGHT = 20;
    const ITEM_GAP = 6;
    const BASE_HEIGHT = 28;
    return rowMeta
      .map((row) => {
        if (!row.hasItems) return "minmax(80px, 1fr)";
        const itemsHeight =
          row.maxItems > 0
            ? row.maxItems * ITEM_HEIGHT + (row.maxItems - 1) * ITEM_GAP
            : 0;
        const lanesHeight = row.maxLanes * LANE_HEIGHT + 6;
        const total = Math.max(80, BASE_HEIGHT + lanesHeight + itemsHeight);
        return `${Math.ceil(total)}px`;
      })
      .join(" ");
  }, [cells, itemsByDate, spanItems]);

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <button
          className="icon-btn"
          onClick={() =>
            setAnchorDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
          }
          aria-label="Previous month"
          title="Previous month"
        >
          ‹
        </button>
        <div className="calendar-title">{monthLabel(anchorDate)}</div>
        <button
          className="icon-btn"
          onClick={() =>
            setAnchorDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
          }
          aria-label="Next month"
          title="Next month"
        >
          ›
        </button>
      </div>
      <div className="calendar-grid">
        <div className="calendar-weekdays">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <div key={label} className="calendar-weekday">
              {label}
            </div>
          ))}
        </div>
        <div
          className="calendar-body"
          style={{
            ["--span-lanes" as any]: spanItems.maxLanes,
            gridTemplateRows: rowTemplate,
          }}
        >
          {cells.map((cell) => {
            const key = dateKey(cell.date);
            const dayItems = itemsByDate.get(key) ?? [];
            return (
              <div
                key={key}
                className={`calendar-cell ${cell.inMonth ? "" : "outside"}`}
              >
                <div className="calendar-date">{cell.date.getDate()}</div>
                <div className="calendar-items">
                  {dayItems.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      className="calendar-item"
                      onClick={() => onOpenItem(item.id)}
                    >
                      {item.title}
                    </button>
                  ))}
                  {dayItems.length > 3 && (
                    <div className="calendar-more">
                      +{dayItems.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div className="calendar-spans" style={{ gridTemplateRows: rowTemplate }}>
            {spanItems.segments.map((segment, index) => (
              <button
                key={`${segment.id}-${index}`}
                className="calendar-span"
                onClick={() => onOpenItem(segment.id)}
                style={{
                  gridColumn: `${segment.col} / span ${segment.span}`,
                  gridRow: `${segment.row}`,
                  ["--lane" as any]: segment.lane,
                }}
              >
                {segment.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

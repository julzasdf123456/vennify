import React, { useEffect, useMemo, useRef, useState } from "react";
import { ItemWithPosition, ModuleCircle } from "../types";
import { distance, isInsideCircle } from "../lib/geometry";

const VIEWBOX = { width: 1000, height: 600 };
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const DRAG_HOLD_MS = 140;
const DRAG_MOVE_THRESHOLD = 6;
const MAX_ITEM_CHARS = 12;
const WRAP_CHARS = 20;
const LINE_HEIGHT = 14;

const wrapText = (value: string, maxChars: number) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    if ((current + " " + word).length <= maxChars || current.length === 0) {
      current = current ? `${current} ${word}` : word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
};

type DragState =
  | {
      type: "module-group";
      moduleIds: string[];
      itemIds: string[];
      startWorld: { x: number; y: number };
      moduleStart: Record<string, { x: number; y: number }>;
      itemStart: Record<string, { x: number; y: number }>;
    }
  | { type: "item"; id: string; offset: { x: number; y: number } }
  | { type: "resize"; id: string; center: { x: number; y: number } };

type PendingDrag = {
  drag: DragState;
  origin: { x: number; y: number };
  timer: number;
};

export type CanvasProps = {
  modules: ModuleCircle[];
  items: ItemWithPosition[];
  showFullItemTitles: boolean;
  selectedItemId: string | null;
  selectedModuleId: string | null;
  onSelectItem: (id: string | null) => void;
  onSelectModule: (id: string | null) => void;
  onOpenItem: (id: string) => void;
  onUpdateModule: (id: string, updates: Partial<ModuleCircle>) => void;
  onUpdateItemPosition: (
    id: string,
    updates: Partial<ItemWithPosition["position"]>
  ) => void;
  onBatchUpdate: (modules: ModuleCircle[], items: ItemWithPosition[]) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onOpenModule?: (id: string) => void;
};

type ClientPoint = { clientX: number; clientY: number };

const toSvgPoint = (evt: ClientPoint, svg: SVGSVGElement | null) => {
  if (!svg) return { x: 0, y: 0 };
  const point = svg.createSVGPoint();
  point.x = evt.clientX;
  point.y = evt.clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const result = point.matrixTransform(matrix.inverse());
  return { x: result.x, y: result.y };
};

export const Canvas: React.FC<CanvasProps> = ({
  modules,
  items,
  showFullItemTitles,
  selectedItemId,
  selectedModuleId,
  onSelectItem,
  onSelectModule,
  onOpenItem,
  onUpdateModule,
  onUpdateItemPosition,
  onBatchUpdate,
  onInteractionStart,
  onInteractionEnd,
  onOpenModule,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const pendingDragRef = useRef<PendingDrag | null>(null);
  const pendingClickItemRef = useRef<string | null>(null);
  const lastClickRef = useRef<{ id: string; at: number } | null>(null);
  const modulesRef = useRef(modules);
  const itemsRef = useRef(items);
  const cameraRef = useRef(camera);

  const orderedModules = useMemo(
    () => [...modules].sort((a, b) => a.zIndex - b.zIndex),
    [modules]
  );
  const orderedItems = useMemo(
    () => [...items].sort((a, b) => a.position.zIndex - b.position.zIndex),
    [items]
  );

  const clampScale = (value: number) =>
    Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

  const toWorldPoint = (svgPoint: { x: number; y: number }) => {
    const current = cameraRef.current;
    return {
      x: (svgPoint.x - current.x) / current.scale,
      y: (svgPoint.y - current.y) / current.scale,
    };
  };

  const zoomAt = (svgPoint: { x: number; y: number }, nextScale: number) => {
    const worldPoint = toWorldPoint(svgPoint);
    setCamera((prev) => ({
      scale: nextScale,
      x: svgPoint.x - worldPoint.x * nextScale,
      y: svgPoint.y - worldPoint.y * nextScale,
    }));
  };

  const clearPendingDrag = () => {
    const pending = pendingDragRef.current;
    if (pending) {
      window.clearTimeout(pending.timer);
      pendingDragRef.current = null;
    }
  };

  const startPendingDrag = (pending: Omit<PendingDrag, "timer">) => {
    clearPendingDrag();
    const timer = window.setTimeout(() => {
      if (!pendingDragRef.current) return;
      const active = pendingDragRef.current;
      setDrag(active.drag);
      onInteractionStart?.();
      pendingClickItemRef.current = null;
      pendingDragRef.current = null;
    }, DRAG_HOLD_MS);
    pendingDragRef.current = { ...pending, timer } as PendingDrag;
  };

  const buildModuleGroupDrag = (
    moduleId: string,
    startWorld: { x: number; y: number },
    options?: { independent?: boolean }
  ): DragState => {
    const moduleMap = new Map(modules.map((module) => [module.id, module]));
    const memberships = new Map<string, string[]>();

    items.forEach((item) => {
      const moduleIds = modules
        .filter((module) => isInsideCircle(item.position, module))
        .map((module) => module.id);
      memberships.set(item.id, moduleIds);
    });

    let moduleIds: string[] = [];
    let itemIds: string[] = [];

    if (options?.independent) {
      moduleIds = [moduleId];
      itemIds = items
        .filter((item) => {
          if (item.ownerModuleId) {
            return item.ownerModuleId === moduleId;
          }
          return (memberships.get(item.id) ?? []).includes(moduleId);
        })
        .map((item) => item.id);
    } else {
      const adjacency = new Map<string, Set<string>>();
      modules.forEach((module) =>
        adjacency.set(module.id, new Set([module.id]))
      );
      memberships.forEach((moduleIds) => {
        moduleIds.forEach((a) => {
          moduleIds.forEach((b) => {
            adjacency.get(a)?.add(b);
          });
        });
      });

      const group = new Set<string>();
      const stack = [moduleId];
      while (stack.length) {
        const current = stack.pop()!;
        if (group.has(current)) continue;
        group.add(current);
        const neighbors = adjacency.get(current);
        if (!neighbors) continue;
        neighbors.forEach((neighbor) => {
          if (!group.has(neighbor)) stack.push(neighbor);
        });
      }

      moduleIds = Array.from(group);
      itemIds = items
        .filter((item) =>
          (memberships.get(item.id) ?? []).some((id) => group.has(id))
        )
        .map((item) => item.id);
    }

    const moduleStart: Record<string, { x: number; y: number }> = {};
    moduleIds.forEach((id) => {
      const module = moduleMap.get(id);
      if (module) {
        moduleStart[id] = { x: module.x, y: module.y };
      }
    });

    const itemStart: Record<string, { x: number; y: number }> = {};
    itemIds.forEach((id) => {
      const item = items.find((entry) => entry.id === id);
      if (item) {
        itemStart[id] = { x: item.position.x, y: item.position.y };
      }
    });

    return {
      type: "module-group",
      moduleIds,
      itemIds,
      startWorld,
      moduleStart,
      itemStart,
    };
  };

  useEffect(() => {
    modulesRef.current = modules;
  }, [modules]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handleWheel = (evt: WheelEvent) => {
      evt.preventDefault();
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const handleMove = (evt: PointerEvent) => {
      if (!drag && pendingDragRef.current) {
        const pending = pendingDragRef.current;
        const dx = evt.clientX - pending.origin.x;
        const dy = evt.clientY - pending.origin.y;
        if (Math.hypot(dx, dy) > DRAG_MOVE_THRESHOLD) {
          clearPendingDrag();
        }
      }

      if (!drag) return;

      const point = toSvgPoint(evt, svgRef.current);
      const worldPoint = toWorldPoint(point);
      if (drag.type === "module-group") {
        const deltaX = worldPoint.x - drag.startWorld.x;
        const deltaY = worldPoint.y - drag.startWorld.y;

        const moduleSet = new Set(drag.moduleIds);
        const itemSet = new Set(drag.itemIds);
        const currentModules = modulesRef.current;
        const currentItems = itemsRef.current;

        const nextModules = currentModules.map((module) => {
          if (!moduleSet.has(module.id)) return module;
          const start = drag.moduleStart[module.id];
          if (!start) return module;
          return {
            ...module,
            x: start.x + deltaX,
            y: start.y + deltaY,
          };
        });

        const nextItems = currentItems.map((item) => {
          if (!itemSet.has(item.id)) return item;
          const start = drag.itemStart[item.id];
          if (!start) return item;
          return {
            ...item,
            position: {
              ...item.position,
              x: start.x + deltaX,
              y: start.y + deltaY,
            },
          };
        });

        onBatchUpdate(nextModules, nextItems);
      }
      if (drag.type === "item") {
        onUpdateItemPosition(drag.id, {
          x: worldPoint.x - drag.offset.x,
          y: worldPoint.y - drag.offset.y,
        });
      }
      if (drag.type === "resize") {
        const radius = Math.max(60, distance(worldPoint, drag.center));
        onUpdateModule(drag.id, { radius });
      }
    };

    const handleUp = () => {
      if (!drag && pendingClickItemRef.current) {
        const now = Date.now();
        const id = pendingClickItemRef.current;
        if (
          lastClickRef.current?.id === id &&
          now - lastClickRef.current.at < 350
        ) {
          onOpenItem(id);
          lastClickRef.current = null;
        } else {
          lastClickRef.current = { id, at: now };
        }
        pendingClickItemRef.current = null;
      }
      clearPendingDrag();
      if (drag) {
        onInteractionEnd?.();
      }
      setDrag(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag, onBatchUpdate, onUpdateItemPosition, onUpdateModule]);

  return (
    <div ref={stageRef} className="canvas-stage">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        width="100%"
        height="100%"
        onWheel={(evt) => {
          const svg = svgRef.current;
          if (!svg) return;
          const rect = svg.getBoundingClientRect();
          const scaleX = VIEWBOX.width / rect.width;
          const scaleY = VIEWBOX.height / rect.height;
          const deltaX = evt.deltaX * scaleX;
          const deltaY = evt.deltaY * scaleY;
          if (evt.ctrlKey || evt.metaKey) {
            const zoomFactor = Math.exp(-deltaY * 0.01);
            const nextScale = clampScale(camera.scale * zoomFactor);
            const point = toSvgPoint(evt, svg);
            zoomAt(point, nextScale);
          } else {
            setCamera((prev) => ({
              ...prev,
              x: prev.x - deltaX,
              y: prev.y - deltaY,
            }));
          }
        }}
        onPointerDown={() => {
          onSelectItem(null);
          onSelectModule(null);
          pendingClickItemRef.current = null;
        }}
      >
        <rect width="100%" height="100%" fill="transparent" />
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
          {orderedModules.map((circle) => {
            const isSelected = selectedModuleId === circle.id;
            const shape = circle.shape ?? "solid";
            const isCircle =
              shape === "solid" || shape === "outline" || shape === "dashed";
            const fillOpacity = shape === "outline" ? 0 : 0.2;
            const strokeDasharray = shape === "dashed" ? "8 6" : undefined;
            return (
              <g key={circle.id}>
                {isCircle ? (
                  <circle
                    cx={circle.x}
                    cy={circle.y}
                    r={circle.radius}
                    fill={circle.color}
                    fillOpacity={fillOpacity}
                    stroke={isSelected ? "var(--accent)" : circle.color}
                    strokeWidth={isSelected ? 3 : 2}
                    strokeDasharray={strokeDasharray}
                    style={{ cursor: circle.locked ? "not-allowed" : "grab" }}
                    onPointerDown={(evt) => {
                      evt.stopPropagation();
                      if (circle.locked) return;
                      const point = toSvgPoint(evt, svgRef.current);
                      const worldPoint = toWorldPoint(point);
                      pendingClickItemRef.current = null;
                      startPendingDrag({
                        drag: buildModuleGroupDrag(circle.id, worldPoint, {
                          independent: evt.shiftKey,
                        }),
                        origin: { x: evt.clientX, y: evt.clientY },
                      });
                      onSelectModule(circle.id);
                    }}
                    onDoubleClick={(evt) => {
                      evt.stopPropagation();
                      onSelectModule(circle.id);
                      onOpenModule?.(circle.id);
                    }}
                  />
                ) : shape === "square" ? (
                  <rect
                    x={circle.x - circle.radius}
                    y={circle.y - circle.radius}
                    width={circle.radius * 2}
                    height={circle.radius * 2}
                    rx={16}
                    fill={circle.color}
                    fillOpacity={0.2}
                    stroke={isSelected ? "var(--accent)" : circle.color}
                    strokeWidth={isSelected ? 3 : 2}
                    style={{ cursor: circle.locked ? "not-allowed" : "grab" }}
                    onPointerDown={(evt) => {
                      evt.stopPropagation();
                      if (circle.locked) return;
                      const point = toSvgPoint(evt, svgRef.current);
                      const worldPoint = toWorldPoint(point);
                      pendingClickItemRef.current = null;
                      startPendingDrag({
                        drag: buildModuleGroupDrag(circle.id, worldPoint, {
                          independent: evt.shiftKey,
                        }),
                        origin: { x: evt.clientX, y: evt.clientY },
                      });
                      onSelectModule(circle.id);
                    }}
                    onDoubleClick={(evt) => {
                      evt.stopPropagation();
                      onSelectModule(circle.id);
                      onOpenModule?.(circle.id);
                    }}
                  />
                ) : (
                  <polygon
                    points={`${circle.x},${circle.y - circle.radius} ${
                      circle.x + circle.radius
                    },${circle.y} ${circle.x},${circle.y + circle.radius} ${
                      circle.x - circle.radius
                    },${circle.y}`}
                    fill={circle.color}
                    fillOpacity={0.2}
                    stroke={isSelected ? "var(--accent)" : circle.color}
                    strokeWidth={isSelected ? 3 : 2}
                    style={{ cursor: circle.locked ? "not-allowed" : "grab" }}
                    onPointerDown={(evt) => {
                      evt.stopPropagation();
                      if (circle.locked) return;
                      const point = toSvgPoint(evt, svgRef.current);
                      const worldPoint = toWorldPoint(point);
                      pendingClickItemRef.current = null;
                      startPendingDrag({
                        drag: buildModuleGroupDrag(circle.id, worldPoint, {
                          independent: evt.shiftKey,
                        }),
                        origin: { x: evt.clientX, y: evt.clientY },
                      });
                      onSelectModule(circle.id);
                    }}
                    onDoubleClick={(evt) => {
                      evt.stopPropagation();
                      onSelectModule(circle.id);
                      onOpenModule?.(circle.id);
                    }}
                  />
                )}
                <text
                  x={circle.x}
                  y={circle.y - circle.radius - 12}
                  textAnchor="middle"
                  fill="var(--canvas-text)"
                  fontSize={14}
                  fontWeight={600}
                  style={{ cursor: "text" }}
                  onDoubleClick={(evt) => {
                    evt.stopPropagation();
                    onSelectModule(circle.id);
                    onOpenModule?.(circle.id);
                  }}
                >
                  {circle.name}
                </text>
                {!circle.locked && (
                  <circle
                    cx={circle.x + circle.radius}
                    cy={circle.y}
                    r={8}
                    fill="var(--accent)"
                    stroke="var(--canvas-resize-stroke)"
                    strokeWidth={2}
                    style={{ cursor: "ew-resize" }}
                    onPointerDown={(evt) => {
                      evt.stopPropagation();
                      startPendingDrag({
                        drag: {
                          type: "resize",
                          id: circle.id,
                          center: { x: circle.x, y: circle.y },
                        },
                        origin: { x: evt.clientX, y: evt.clientY },
                      });
                      onSelectModule(circle.id);
                    }}
                  />
                )}
              </g>
            );
          })}

          {orderedItems.map((item) => {
            const compactTitle =
              item.title.length > MAX_ITEM_CHARS
                ? `${item.title.slice(0, MAX_ITEM_CHARS - 1)}…`
                : item.title;
            const fullTitle = item.icon
              ? `${item.icon} ${item.title}`
              : item.title;
            const lines = showFullItemTitles
              ? wrapText(fullTitle, WRAP_CHARS)
              : [compactTitle];
            const longestLine =
              lines.reduce((max, line) => Math.max(max, line.length), 0) || 1;
            const width = Math.max(70, longestLine * 6 + 18);
            const height = showFullItemTitles
              ? lines.length * LINE_HEIGHT + 12
              : 22;
            const isSelected = selectedItemId === item.id;
            const chipColor = item.color ?? null;
            const fillColor = isSelected
              ? "var(--accent)"
              : chipColor ?? "var(--canvas-chip-fill)";
            const fillOpacity = isSelected ? 1 : chipColor ? 0.22 : 1;
            const strokeColor = isSelected
              ? "var(--accent)"
              : chipColor ?? "var(--canvas-chip-stroke)";
            return (
              <g
                key={item.id}
                transform={`translate(${item.position.x}, ${item.position.y})`}
                style={{ cursor: "grab" }}
                onPointerDown={(evt) => {
                  evt.stopPropagation();
                  const point = toSvgPoint(evt, svgRef.current);
                  const worldPoint = toWorldPoint(point);
                  pendingClickItemRef.current = item.id;
                  startPendingDrag({
                    drag: {
                      type: "item",
                      id: item.id,
                      offset: {
                        x: worldPoint.x - item.position.x,
                        y: worldPoint.y - item.position.y,
                      },
                    },
                    origin: { x: evt.clientX, y: evt.clientY },
                  });
                  onSelectItem(item.id);
                }}
              >
                <rect
                  x={-width / 2}
                  y={-height / 2}
                  width={width}
                  height={height}
                  rx={12}
                  fill={fillColor}
                  fillOpacity={fillOpacity}
                  stroke={strokeColor}
                  strokeWidth={1}
                />
                <text
                  x={0}
                  y={showFullItemTitles ? -(lines.length - 1) * (LINE_HEIGHT / 2) + 3 : 3}
                  textAnchor="middle"
                  fill={
                    isSelected
                      ? "var(--canvas-selected-text)"
                      : "var(--canvas-text)"
                  }
                  fontSize={11}
                  fontWeight={600}
                >
                  {lines.map((line, idx) => (
                    <tspan
                      key={`${item.id}-line-${idx}`}
                      x={0}
                      dy={idx === 0 ? 0 : LINE_HEIGHT}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="canvas-controls">
        <button
          className="canvas-btn"
          onClick={() => {
            const nextScale = clampScale(camera.scale / 1.1);
            zoomAt({ x: VIEWBOX.width / 2, y: VIEWBOX.height / 2 }, nextScale);
          }}
        >
          -
        </button>
        <span className="canvas-zoom">
          {Math.round(camera.scale * 100)}%
        </span>
        <button
          className="canvas-btn"
          onClick={() => {
            const nextScale = clampScale(camera.scale * 1.1);
            zoomAt({ x: VIEWBOX.width / 2, y: VIEWBOX.height / 2 }, nextScale);
          }}
        >
          +
        </button>
        <button
          className="canvas-btn"
          onClick={() => setCamera({ x: 0, y: 0, scale: 1 })}
        >
          Reset
        </button>
      </div>
    </div>
  );
};

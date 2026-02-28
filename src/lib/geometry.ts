import { ItemWithPosition, Membership, ModuleCircle } from "../types";

type Point = { x: number; y: number };

export const distance = (a: Point, b: Point) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
};

export const isInsideCircle = (point: Point, circle: ModuleCircle) => {
  const shape = circle.shape ?? "solid";
  const dx = point.x - circle.x;
  const dy = point.y - circle.y;

  if (shape === "square") {
    return Math.abs(dx) <= circle.radius && Math.abs(dy) <= circle.radius;
  }

  if (shape === "diamond") {
    return Math.abs(dx) + Math.abs(dy) <= circle.radius;
  }

  return distance(point, circle) <= circle.radius;
};

export const computeMemberships = (
  items: ItemWithPosition[],
  modules: ModuleCircle[]
): Membership[] =>
  items.map((item) => ({
    itemId: item.id,
    moduleIds: modules
      .filter((circle) => isInsideCircle(item.position, circle))
      .map((circle) => circle.id),
  }));

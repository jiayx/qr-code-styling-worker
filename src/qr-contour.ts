import { formatSvgNumber } from "./svg-rendering.js";

interface GridPoint {
  x: number;
  y: number;
}

interface BoundaryEdge {
  column: number;
  direction: 0 | 1 | 2 | 3;
  end: GridPoint;
  row: number;
  start: GridPoint;
}

export interface ContourOptions {
  count: number;
  isDrawn: (row: number, column: number) => boolean;
  moduleSize: number;
  type: string;
  xOffset: number;
  yOffset: number;
}

interface Corner {
  entry: GridPoint;
  exit: GridPoint;
  radius: number;
}

export function buildContourPath(
  cells: Array<{ column: number; row: number }>,
  options: ContourOptions,
): string | undefined {
  const edges: BoundaryEdge[] = [];
  for (const { column, row } of cells) {
    if (!options.isDrawn(row - 1, column)) {
      edges.push(edge(column, row, column + 1, row, 0, row, column));
    }
    if (!options.isDrawn(row, column + 1)) {
      edges.push(edge(column + 1, row, column + 1, row + 1, 1, row, column));
    }
    if (!options.isDrawn(row + 1, column)) {
      edges.push(edge(column + 1, row + 1, column, row + 1, 2, row, column));
    }
    if (!options.isDrawn(row, column - 1)) {
      edges.push(edge(column, row + 1, column, row, 3, row, column));
    }
  }
  if (!edges.length) return undefined;

  const outgoing = new Map<string, number[]>();
  edges.forEach((boundary, index) => {
    const key = pointKey(boundary.start);
    const indexes = outgoing.get(key) ?? [];
    indexes.push(index);
    outgoing.set(key, indexes);
  });

  const remaining = new Set(edges.map((_, index) => index));
  const contours: BoundaryEdge[][] = [];
  while (remaining.size) {
    const firstIndex = remaining.values().next().value as number | undefined;
    if (firstIndex === undefined) break;
    const first = edges[firstIndex];
    if (!first) return undefined;

    const contour: BoundaryEdge[] = [];
    let currentIndex = firstIndex;
    while (true) {
      const current = edges[currentIndex];
      if (!current || !remaining.delete(currentIndex)) return undefined;
      contour.push(current);
      if (samePoint(current.end, first.start)) break;

      const candidates = (outgoing.get(pointKey(current.end)) ?? [])
        .filter((candidate) => remaining.has(candidate));
      const nextIndex = chooseNextEdge(current, candidates, edges);
      if (nextIndex === undefined) return undefined;
      currentIndex = nextIndex;
    }
    contours.push(contour);
  }

  return contours.map((contour) => contourPath(contour, options)).join(" ");
}

function contourPath(contour: BoundaryEdge[], options: ContourOptions): string {
  const corners = contour.flatMap((outgoing, index) => {
    const incoming = contour[(index + contour.length - 1) % contour.length];
    if ((incoming as BoundaryEdge).direction === outgoing.direction) return [];
    return [buildCorner(incoming as BoundaryEdge, outgoing, options)];
  });
  const first = corners[0] as Corner;
  const commands = [`M ${svgPoint(first.exit, options)}`];
  let current = first.exit;

  for (let index = 1; index < corners.length; index += 1) {
    current = appendCorner(
      commands,
      corners[index] as Corner,
      current,
      options,
    );
  }
  if (first.radius > 0) appendCorner(commands, first, current, options);
  commands.push("Z");
  return commands.join(" ");
}

function appendCorner(
  commands: string[],
  corner: Corner,
  current: GridPoint,
  options: ContourOptions,
): GridPoint {
  if (!samePoint(current, corner.entry)) {
    appendLine(commands, current, corner.entry, options);
  }
  if (corner.radius > 0) {
    const radius = corner.radius * options.moduleSize;
    commands.push(
      `A ${formatSvgNumber(radius)} ${formatSvgNumber(radius)} 0 0 1 ${svgPoint(corner.exit, options)}`,
    );
  }
  return corner.exit;
}

function appendLine(
  commands: string[],
  current: GridPoint,
  target: GridPoint,
  options: ContourOptions,
): void {
  if (current.y === target.y) {
    commands.push(`H ${svgX(target.x, options)}`);
  } else if (current.x === target.x) {
    commands.push(`V ${svgY(target.y, options)}`);
  } else {
    commands.push(`L ${svgPoint(target, options)}`);
  }
}

function buildCorner(
  incoming: BoundaryEdge,
  outgoing: BoundaryEdge,
  options: ContourOptions,
): Corner {
  const vertex = outgoing.start;
  const isConvex = incoming.row === outgoing.row &&
    incoming.column === outgoing.column &&
    turn(incoming.direction, outgoing.direction) === 1;
  const radius = isConvex
    ? cornerRadius(outgoing.row, outgoing.column, vertex, options)
    : 0;
  const incomingVector = directionVector(incoming.direction);
  const outgoingVector = directionVector(outgoing.direction);
  return {
    entry: {
      x: vertex.x - incomingVector.x * radius,
      y: vertex.y - incomingVector.y * radius,
    },
    exit: {
      x: vertex.x + outgoingVector.x * radius,
      y: vertex.y + outgoingVector.y * radius,
    },
    radius,
  };
}

function cornerRadius(
  row: number,
  column: number,
  vertex: GridPoint,
  options: ContourOptions,
): number {
  const left = options.isDrawn(row, column - 1);
  const right = options.isDrawn(row, column + 1);
  const top = options.isDrawn(row - 1, column);
  const bottom = options.isDrawn(row + 1, column);
  const count = Number(left) + Number(right) + Number(top) + Number(bottom);
  const topLeft = vertex.x === column && vertex.y === row;
  const bottomRight = vertex.x === column + 1 && vertex.y === row + 1;

  switch (options.type) {
    case "rounded":
      return count <= 2 && !(left && right) && !(top && bottom) ? 0.5 : 0;
    case "extra-rounded":
      if (count === 2 && !(left && right) && !(top && bottom)) return 1;
      return count <= 1 ? 0.5 : 0;
    case "diagonal-rounded":
      if (count === 0) return topLeft || bottomRight ? 0.5 : 0;
      if (!left && !top && topLeft) return 0.5;
      if (!right && !bottom && bottomRight) return 0.5;
      return 0;
    case "diagonal-extra-rounded":
      if (count === 0) return topLeft || bottomRight ? 0.5 : 0;
      if (!left && !top && topLeft) return 1;
      if (!right && !bottom && bottomRight) return 1;
      return 0;
    default:
      return 0;
  }
}

function chooseNextEdge(
  current: BoundaryEdge,
  candidates: number[],
  edges: BoundaryEdge[],
): number | undefined {
  const priority = [1, 0, 3, 2];
  return candidates.sort((left, right) => {
    const leftEdge = edges[left] as BoundaryEdge;
    const rightEdge = edges[right] as BoundaryEdge;
    return priority.indexOf(turn(current.direction, leftEdge.direction)) -
      priority.indexOf(turn(current.direction, rightEdge.direction));
  })[0];
}

function edge(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  direction: 0 | 1 | 2 | 3,
  row: number,
  column: number,
): BoundaryEdge {
  return {
    column,
    direction,
    end: { x: endX, y: endY },
    row,
    start: { x: startX, y: startY },
  };
}

function directionVector(direction: number): GridPoint {
  return [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ][direction] as GridPoint;
}

function turn(from: number, to: number): number {
  return (to - from + 4) % 4;
}

function svgPoint(point: GridPoint, options: ContourOptions): string {
  return `${svgX(point.x, options)} ${svgY(point.y, options)}`;
}

function svgX(x: number, options: ContourOptions): string {
  return formatSvgNumber(options.xOffset + x * options.moduleSize);
}

function svgY(y: number, options: ContourOptions): string {
  return formatSvgNumber(options.yOffset + y * options.moduleSize);
}

function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

function samePoint(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

import type {
  CornerDotType,
  CornerSquareType,
  DotType,
  FinderCenterShape,
  FinderFrameShape,
  ModuleShape,
} from "./types.js";

const moduleShapeAliases: Readonly<Record<DotType, ModuleShape>> = {
  circle: "circle",
  rounded: "rounded",
  "diagonal-rounded": "diagonal-rounded",
  "diagonal-extra-rounded": "diagonal-extra-rounded",
  square: "square",
  "extra-rounded": "extra-rounded",
  dots: "circle",
  classy: "diagonal-rounded",
  "classy-rounded": "diagonal-extra-rounded",
};

const finderFrameShapeAliases: Readonly<
  Record<CornerSquareType, FinderFrameShape>
> = {
  circle: "circle",
  square: "square",
  rounded: "rounded",
  "extra-rounded": "extra-rounded",
  dot: "circle",
};

const finderCenterShapeAliases: Readonly<
  Record<CornerDotType, FinderCenterShape>
> = {
  circle: "circle",
  square: "square",
  rounded: "rounded",
  dot: "circle",
};

function lookup<T>(aliases: Readonly<Record<string, T>>, value: unknown): T | undefined {
  if (typeof value !== "string" || !Object.hasOwn(aliases, value)) return undefined;
  return aliases[value];
}

export function parseModuleShape(value: unknown): ModuleShape | undefined {
  return lookup(moduleShapeAliases, value);
}

export function parseFinderFrameShape(
  value: unknown,
): FinderFrameShape | undefined {
  return lookup(finderFrameShapeAliases, value);
}

export function parseFinderCenterShape(
  value: unknown,
): FinderCenterShape | undefined {
  return lookup(finderCenterShapeAliases, value);
}

export function normalizeModuleShape(type: DotType): ModuleShape {
  const normalized = parseModuleShape(type);
  if (normalized === undefined) throw new TypeError(`Unsupported module shape: ${type}`);
  return normalized;
}

export function normalizeFinderFrameShape(
  type: CornerSquareType,
): FinderFrameShape {
  const normalized = parseFinderFrameShape(type);
  if (normalized === undefined) {
    throw new TypeError(`Unsupported finder frame shape: ${type}`);
  }
  return normalized;
}

export function normalizeFinderCenterShape(
  type: CornerDotType,
): FinderCenterShape {
  const normalized = parseFinderCenterShape(type);
  if (normalized === undefined) {
    throw new TypeError(`Unsupported finder center shape: ${type}`);
  }
  return normalized;
}

export function moduleShapeToFinderFrame(type: ModuleShape): FinderFrameShape {
  switch (type) {
    case "circle":
      return "circle";
    case "rounded":
    case "diagonal-rounded":
      return "rounded";
    case "extra-rounded":
    case "diagonal-extra-rounded":
      return "extra-rounded";
    default:
      return "square";
  }
}

export function moduleShapeToFinderCenter(type: ModuleShape): FinderCenterShape {
  switch (type) {
    case "circle":
    case "extra-rounded":
      return "circle";
    case "rounded":
    case "diagonal-rounded":
    case "diagonal-extra-rounded":
      return "rounded";
    default:
      return "square";
  }
}

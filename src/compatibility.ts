import type { Mode, UnknownObject } from "./types.js";

export interface ImageSizeOptions {
  originalHeight: number;
  originalWidth: number;
  maxHiddenDots: number;
  maxHiddenAxisDots?: number;
  dotSize: number;
}
export interface ImageSizeResult {
  height: number;
  width: number;
  hideYDots: number;
  hideXDots: number;
}

export function getMode(data: unknown): Mode {
  const value = String(data);
  if (/^[0-9]*$/.test(value)) return "Numeric";
  if (/^[0-9A-Z $%*+\-./:]*$/.test(value)) return "Alphanumeric";
  return "Byte";
}

export function calculateImageSize({
  originalHeight,
  originalWidth,
  maxHiddenDots,
  maxHiddenAxisDots,
  dotSize,
}: ImageSizeOptions): ImageSizeResult {
  if (
    originalHeight <= 0 || originalWidth <= 0 || maxHiddenDots <= 0 ||
    dotSize <= 0
  ) {
    return { height: 0, width: 0, hideYDots: 0, hideXDots: 0 };
  }

  const ratio = originalHeight / originalWidth;
  let hideXDots = Math.floor(Math.sqrt(maxHiddenDots / ratio));
  if (hideXDots <= 0) hideXDots = 1;
  if (maxHiddenAxisDots && maxHiddenAxisDots < hideXDots) {
    hideXDots = maxHiddenAxisDots;
  }
  if (hideXDots % 2 === 0) hideXDots -= 1;
  let width = hideXDots * dotSize;
  let hideYDots = 1 + 2 * Math.ceil((hideXDots * ratio - 1) / 2);
  let height = Math.round(width * ratio);

  if (
    hideYDots * hideXDots > maxHiddenDots ||
    (maxHiddenAxisDots && maxHiddenAxisDots < hideYDots)
  ) {
    if (maxHiddenAxisDots && maxHiddenAxisDots < hideYDots) {
      hideYDots = maxHiddenAxisDots;
      if (hideYDots % 2 === 0) hideXDots -= 1;
    } else {
      hideYDots -= 2;
    }
    height = hideYDots * dotSize;
    hideXDots = 1 + 2 * Math.ceil((hideYDots / ratio - 1) / 2);
    width = Math.round(height / ratio);
  }

  return { height, width, hideYDots, hideXDots };
}

function isObject(value: unknown): value is UnknownObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeDeep(
  target: UnknownObject,
  ...sources: Array<UnknownObject | undefined>
): UnknownObject {
  if (!sources.length) return target;
  const source = sources.shift();
  if (!source || !isObject(target) || !isObject(source)) return target;
  const result: UnknownObject = { ...target };
  for (const key of Object.keys(source)) {
    const targetValue = result[key];
    const sourceValue = source[key];
    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      result[key] = sourceValue;
    } else if (isObject(targetValue) && isObject(sourceValue)) {
      result[key] = mergeDeep({ ...targetValue }, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }
  return mergeDeep(result, ...sources);
}

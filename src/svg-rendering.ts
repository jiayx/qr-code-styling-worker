import type { Options, QRCode } from "qr-code-styling";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SEAM_OVERLAP_ATTRIBUTE = "data-qr-seam-overlap";
const SEAM_BRIDGE_ATTRIBUTE = "data-qr-seam-bridge";
const SVG_NUMBER_PRECISION = 6;
const SVG_NUMBER_FACTOR = 10 ** SVG_NUMBER_PRECISION;
const SVG_NUMBER_PATTERN = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
const NUMERIC_SVG_ATTRIBUTES = [
  "cx",
  "cy",
  "d",
  "fx",
  "fy",
  "gradientTransform",
  "height",
  "markerHeight",
  "markerWidth",
  "pathLength",
  "patternTransform",
  "points",
  "r",
  "refX",
  "refY",
  "rx",
  "ry",
  "stroke-width",
  "transform",
  "viewBox",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
] as const;

export interface SvgRenderingOptions {
  /**
   * Overlaps the final painted QR layer by this many SVG units to hide
   * anti-aliasing seams at fractional module boundaries.
   */
  seamOverlap?: number;
}

export function normalizeSeamOverlap(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0 || value > 0.5) {
    throw new RangeError("svgOptions.seamOverlap must be between 0 and 0.5");
  }
  return value;
}

export function applySvgRenderingFixes(
  svg: SVGElement,
  seamOverlap: number,
  qr?: QRCode,
  options?: Options,
): void {
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  if (seamOverlap > 0 && qr && options) {
    addAdjacentModuleBridges(svg, qr, options, seamOverlap);
  }
  normalizeSvgCoordinates(svg);
}

function addAdjacentModuleBridges(
  svg: SVGElement,
  qr: QRCode,
  options: Options,
  overlap: number,
): void {
  if (options.dotsOptions?.type === "dots") return;
  if (svg.querySelector(`[${SEAM_BRIDGE_ATTRIBUTE}]`)) return;

  const width = options.width;
  const height = options.height;
  if (width === undefined || height === undefined) return;

  const count = qr.getModuleCount();
  const margin = options.margin ?? 0;
  const availableSize = Math.min(width, height) - 2 * margin;
  const qrSize = options.shape === "circle"
    ? availableSize / Math.sqrt(2)
    : availableSize;
  const moduleSize = qrSize / count;
  const xOffset = (width - count * moduleSize) / 2;
  const yOffset = (height - count * moduleSize) / 2;
  const clipPath = svg.querySelector(
    'clipPath[id^="clip-path-dot-color-"]',
  );
  if (!clipPath) return;
  const clipPathId = clipPath.getAttribute("id");
  const paintedLayer = Array.from(svg.querySelectorAll("[clip-path]")).find(
    (element) => parseClipPathId(element.getAttribute("clip-path")) === clipPathId,
  );
  if (!paintedLayer) return;

  const hiddenLogoBounds = getHiddenLogoBounds(svg, options);
  const isDrawn = (row: number, column: number) =>
    qr.isDark(row, column) &&
    !isFinderModule(row, column, count) &&
    !isModuleHiddenByLogo(
      row,
      column,
      moduleSize,
      xOffset,
      yOffset,
      hiddenLogoBounds,
    );
  const verticalPath = createVerticalBridgePath(
    count,
    isDrawn,
    moduleSize,
    xOffset,
    yOffset,
    overlap,
  );
  const horizontalPath = createHorizontalBridgePath(
    count,
    isDrawn,
    moduleSize,
    xOffset,
    yOffset,
    overlap,
  );

  appendBridgePath(paintedLayer, "vertical", verticalPath, overlap);
  appendBridgePath(paintedLayer, "horizontal", horizontalPath, overlap);
}

function createVerticalBridgePath(
  count: number,
  isDrawn: (row: number, column: number) => boolean,
  moduleSize: number,
  xOffset: number,
  yOffset: number,
  overlap: number,
): string {
  const segments: string[] = [];

  for (let column = 0; column < count - 1; column += 1) {
    let row = 0;
    while (row < count) {
      if (!isDrawn(row, column) || !isDrawn(row, column + 1)) {
        row += 1;
        continue;
      }

      const start = row;
      do row += 1;
      while (
        row < count &&
        isDrawn(row, column) &&
        isDrawn(row, column + 1)
      );

      segments.push(rectPath(
        xOffset + (column + 1) * moduleSize - overlap,
        yOffset + start * moduleSize,
        2 * overlap,
        (row - start) * moduleSize,
      ));
    }
  }

  return segments.join(" ");
}

function createHorizontalBridgePath(
  count: number,
  isDrawn: (row: number, column: number) => boolean,
  moduleSize: number,
  xOffset: number,
  yOffset: number,
  overlap: number,
): string {
  const segments: string[] = [];

  for (let row = 0; row < count - 1; row += 1) {
    let column = 0;
    while (column < count) {
      if (!isDrawn(row, column) || !isDrawn(row + 1, column)) {
        column += 1;
        continue;
      }

      const start = column;
      do column += 1;
      while (
        column < count &&
        isDrawn(row, column) &&
        isDrawn(row + 1, column)
      );

      segments.push(rectPath(
        xOffset + start * moduleSize,
        yOffset + (row + 1) * moduleSize - overlap,
        (column - start) * moduleSize,
        2 * overlap,
      ));
    }
  }

  return segments.join(" ");
}

function appendBridgePath(
  paintedLayer: Element,
  direction: "horizontal" | "vertical",
  pathData: string,
  overlap: number,
): void {
  if (!pathData) return;

  const parent = paintedLayer.parentNode;
  if (!parent) return;

  const path = paintedLayer.ownerDocument.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute(SEAM_BRIDGE_ATTRIBUTE, direction);
  path.setAttribute(SEAM_OVERLAP_ATTRIBUTE, String(overlap));
  path.setAttribute("d", pathData);
  for (const attribute of ["fill", "fill-opacity", "opacity", "style"]) {
    const value = paintedLayer.getAttribute(attribute);
    if (value !== null) path.setAttribute(attribute, value);
  }
  parent.insertBefore(path, paintedLayer.nextSibling);
}

function isFinderModule(row: number, column: number, count: number): boolean {
  return (
    (row < 7 && column < 7) ||
    (row < 7 && column >= count - 7) ||
    (row >= count - 7 && column < 7)
  );
}

interface Bounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

function getHiddenLogoBounds(
  svg: SVGElement,
  options: Options,
): Bounds | undefined {
  if (!options.image || options.imageOptions?.hideBackgroundDots === false) {
    return undefined;
  }

  const image = svg.querySelector("image");
  if (!image) return undefined;

  const x = Number.parseFloat(image.getAttribute("x") ?? "");
  const y = Number.parseFloat(image.getAttribute("y") ?? "");
  const width = Number.parseFloat(image.getAttribute("width") ?? "");
  const height = Number.parseFloat(image.getAttribute("height") ?? "");
  if (![x, y, width, height].every(Number.isFinite)) return undefined;

  const margin = options.imageOptions?.margin ?? 0;
  return {
    bottom: y + height + margin,
    left: x - margin,
    right: x + width + margin,
    top: y - margin,
  };
}

function isModuleHiddenByLogo(
  row: number,
  column: number,
  moduleSize: number,
  xOffset: number,
  yOffset: number,
  bounds: Bounds | undefined,
): boolean {
  if (!bounds) return false;

  const centerX = xOffset + (column + 0.5) * moduleSize;
  const centerY = yOffset + (row + 0.5) * moduleSize;
  return (
    centerX > bounds.left &&
    centerX < bounds.right &&
    centerY > bounds.top &&
    centerY < bounds.bottom
  );
}

function rectPath(x: number, y: number, width: number, height: number): string {
  return `M ${x} ${y}h ${width}v ${height}h ${-width}z`;
}

function parseClipPathId(value: string | null): string | undefined {
  if (!value) return undefined;
  return /^url\(["']?#([^"')]+)["']?\)$/.exec(value)?.[1];
}

export function normalizeSvgCoordinates(svg: SVGElement): void {
  const elements = [svg, ...Array.from(svg.querySelectorAll("*"))];

  for (const element of elements) {
    for (const attribute of NUMERIC_SVG_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      element.setAttribute(attribute, normalizeSvgNumericValue(value));
    }
  }
}

export function normalizeSvgNumericValue(value: string): string {
  return value.replace(SVG_NUMBER_PATTERN, (token) => {
    const number = Number(token);
    if (!Number.isFinite(number)) return token;

    const rounded = Math.round(number * SVG_NUMBER_FACTOR) / SVG_NUMBER_FACTOR;
    return String(Object.is(rounded, -0) ? 0 : rounded);
  });
}

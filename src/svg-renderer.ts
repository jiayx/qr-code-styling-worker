import { buildContourPath } from "./qr-contour.js";
import { calculateImageSize } from "./compatibility.js";
import { formatSvgNumber } from "./svg-rendering.js";
import type { QrMatrix } from "./encoder.js";
import type { ImageResourceStore } from "./image-resource-store.js";
import type { ResolvedOptions } from "./options.js";
import {
  moduleShapeToFinderCenter,
  moduleShapeToFinderFrame,
} from "./shapes.js";
import type {
  FinderCenterShape,
  FinderFrameShape,
  Gradient,
} from "./types.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const finderPattern = [
  [0, 0, 0],
  [1, 0, 1],
  [0, 1, -1],
] as const;
const errorCorrectionPercent = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };
let instanceCount = 0;

interface RuntimeWindow {
  document: Document;
  Image: new () => HTMLImageElement;
}

interface LoadedLogo {
  height: number;
  href: string;
  width: number;
}

interface LogoLayout extends LoadedLogo {
  hideColumns: number;
  hideRows: number;
  renderedHeight: number;
  renderedWidth: number;
  x: number;
  y: number;
}

interface PaintBounds {
  additionalRotation?: number;
  height: number;
  width: number;
  x: number;
  y: number;
}

function svgElement(document: Document, name: string): SVGElement {
  return document.createElementNS(SVG_NAMESPACE, name) as SVGElement;
}

function n(value: number): string {
  return formatSvgNumber(value);
}

export function createSvgRoot(
  window: RuntimeWindow,
  options: ResolvedOptions,
): SVGElement {
  const svg = svgElement(window.document, "svg");
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  svg.setAttribute("width", n(options.width));
  svg.setAttribute("height", n(options.height));
  svg.setAttribute("viewBox", `0 0 ${n(options.width)} ${n(options.height)}`);
  if (!options.dotsOptions.roundSize) {
    svg.setAttribute("shape-rendering", "geometricPrecision");
  }
  return svg;
}

export async function renderSvg(
  svg: SVGElement,
  qr: QrMatrix,
  options: ResolvedOptions,
  window: RuntimeWindow,
  seamOverlap: number,
  imageStore?: ImageResourceStore,
  renderId?: number | string,
): Promise<void> {
  while (svg.firstChild) svg.firstChild.remove();
  const document = svg.ownerDocument;
  const defs = svgElement(document, "defs");
  svg.appendChild(defs);
  const instanceId = renderId ?? instanceCount++;

  drawAccessibility(svg, options, instanceId);

  drawBackground(svg, defs, options, instanceId);

  const count = qr.getModuleCount();
  const availableSize = Math.min(options.width, options.height) - 2 * options.margin;
  const qrSize = options.shape === "circle"
    ? availableSize / Math.sqrt(2)
    : availableSize;
  const moduleSize = options.dotsOptions.roundSize
    ? Math.floor(qrSize / count)
    : qrSize / count;
  if (moduleSize <= 0) throw new Error("The canvas is too small");
  const rawXOffset = (options.width - count * moduleSize) / 2;
  const rawYOffset = (options.height - count * moduleSize) / 2;
  const xOffset = options.dotsOptions.roundSize ? Math.floor(rawXOffset) : rawXOffset;
  const yOffset = options.dotsOptions.roundSize ? Math.floor(rawYOffset) : rawYOffset;

  const loadedLogo = options.image
    ? await loadLogo(
      window,
      options.image,
      options.imageOptions.crossOrigin,
      options.imageOptions.saveAsBlob,
      imageStore,
    )
    : undefined;
  const logo = loadedLogo
    ? calculateLogoLayout(loadedLogo, options, count, moduleSize, xOffset, yOffset)
    : undefined;

  const qrGroup = svgElement(document, "g");
  qrGroup.setAttribute("data-qr-layer", "true");
  svg.appendChild(qrGroup);

  const isDataModule = (row: number, column: number) =>
    row >= 0 && column >= 0 && row < count && column < count &&
    qr.isDark(row, column) && !isFinderModule(row, column, count) &&
    !isHiddenByLogo(row, column, count, logo, options);

  const cells = collectDataCells(
    qr,
    count,
    isDataModule,
    options.shape,
    moduleSize,
    availableSize,
  );
  const drawn = new Set(cells.map(({ column, row }) => `${row},${column}`));
  const isDrawn = (row: number, column: number) => drawn.has(`${row},${column}`);
  if (options.shape === "circle") {
    const decorationCount = cells.filter(({ column, row }) =>
      row < 0 || column < 0 || row >= count || column >= count
    ).length;
    qrGroup.setAttribute(
      "data-qr-circle-decoration-count",
      String(decorationCount),
    );
  }

  const dataFill = createPaint(
    defs,
    options.dotsOptions.color,
    options.dotsOptions.gradient,
    `dots-${instanceId}`,
    { x: 0, y: 0, width: options.width, height: options.height },
  );
  if (options.dotsOptions.type === "circle") {
    drawDotPath(
      qrGroup,
      cells,
      moduleSize,
      xOffset,
      yOffset,
      dataFill,
    );
  } else {
    const pathData = buildContourPath(cells, {
      count,
      isDrawn,
      moduleSize,
      seamOverlap,
      type: options.dotsOptions.type,
      xOffset,
      yOffset,
    });
    if (pathData) {
      const path = svgElement(document, "path");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", dataFill);
      path.setAttribute("fill-rule", "evenodd");
      path.setAttribute("data-qr-contour-path", "true");
      path.setAttribute("data-qr-contour-layer", "true");
      if (seamOverlap > 0) {
        path.setAttribute("data-qr-seam-overlap", n(seamOverlap));
      }
      qrGroup.appendChild(path);
    }
  }

  drawFinders(qrGroup, defs, options, count, moduleSize, xOffset, yOffset, instanceId);
  if (logo) drawLogo(svg, defs, logo, options, instanceId);
  drawFrame(svg, options);
  if (!defs.firstChild) defs.remove();
}

function drawAccessibility(
  svg: SVGElement,
  options: ResolvedOptions,
  instanceId: number | string,
): void {
  const ids: string[] = [];
  if (options.accessibilityOptions.title) {
    const title = svgElement(svg.ownerDocument, "title");
    const id = `qr-title-${instanceId}`;
    title.setAttribute("id", id);
    title.textContent = options.accessibilityOptions.title;
    svg.appendChild(title);
    ids.push(id);
  }
  if (options.accessibilityOptions.description) {
    const description = svgElement(svg.ownerDocument, "desc");
    const id = `qr-description-${instanceId}`;
    description.setAttribute("id", id);
    description.textContent = options.accessibilityOptions.description;
    svg.appendChild(description);
    ids.push(id);
  }
  if (ids.length) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", ids.join(" "));
  }
}

function drawFrame(svg: SVGElement, options: ResolvedOptions): void {
  const frame = options.frameOptions;
  if (frame.type === "none" || frame.width <= 0) return;
  const inset = frame.width / 2;
  const border = svgElement(svg.ownerDocument, "rect");
  border.setAttribute("x", n(inset));
  border.setAttribute("y", n(inset));
  border.setAttribute("width", n(options.width - frame.width));
  border.setAttribute("height", n(options.height - frame.width));
  border.setAttribute("fill", "none");
  border.setAttribute("stroke", frame.color);
  border.setAttribute("stroke-width", n(frame.width));
  if (frame.type === "rounded") border.setAttribute("rx", n(frame.radius));
  border.setAttribute("data-qr-frame", "true");
  svg.appendChild(border);

  if (!frame.text) return;
  const text = svgElement(svg.ownerDocument, "text");
  text.setAttribute("x", n(options.width / 2));
  text.setAttribute("y", n(options.height - Math.max(frame.width * 2, frame.fontSize * 0.6)));
  text.setAttribute("fill", frame.textColor);
  text.setAttribute("font-size", n(frame.fontSize));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("data-qr-frame-text", "true");
  text.textContent = frame.text;
  svg.appendChild(text);
}

function collectDataCells(
  qr: QrMatrix,
  count: number,
  isCoreDataModule: (row: number, column: number) => boolean,
  shape: string,
  moduleSize: number,
  availableSize: number,
): Array<{ column: number; row: number }> {
  const cells: Array<{ column: number; row: number }> = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (isCoreDataModule(row, column)) cells.push({ column, row });
    }
  }
  if (shape !== "circle") return cells;

  const additional = Math.max(
    0,
    Math.floor((availableSize / moduleSize - count) / 2),
  );
  const fakeCount = count + additional * 2;
  const center = fakeCount / 2;
  const sourceIndex = (index: number) => {
    if (index < additional * 2) return index;
    if (index >= count) return index - additional * 2;
    return index - additional;
  };
  for (let fakeRow = 0; fakeRow < fakeCount; fakeRow += 1) {
    for (let fakeColumn = 0; fakeColumn < fakeCount; fakeColumn += 1) {
      // Keep a one-module quiet moat around the real QR matrix. Without it,
      // decorations can touch finder patterns and make the code unreadable.
      if (
        fakeRow >= additional - 1 && fakeRow <= fakeCount - additional &&
        fakeColumn >= additional - 1 && fakeColumn <= fakeCount - additional
      ) continue;
      if (Math.hypot(fakeRow - center, fakeColumn - center) > center) continue;
      if (qr.isDark(sourceIndex(fakeColumn), sourceIndex(fakeRow))) {
        cells.push({
          column: fakeColumn - additional,
          row: fakeRow - additional,
        });
      }
    }
  }
  return cells;
}

function drawBackground(
  svg: SVGElement,
  defs: SVGElement,
  options: ResolvedOptions,
  instanceId: number | string,
): void {
  const rect = svgElement(svg.ownerDocument, "rect");
  let width = options.width;
  let height = options.height;
  let x = 0;
  let y = 0;
  if (options.backgroundOptions.round > 0) {
    width = height = Math.min(options.width, options.height);
    x = (options.width - width) / 2;
    y = (options.height - height) / 2;
    rect.setAttribute(
      "rx",
      n(width * options.backgroundOptions.round / 2),
    );
  }
  rect.setAttribute("x", n(x));
  rect.setAttribute("y", n(y));
  rect.setAttribute("width", n(width));
  rect.setAttribute("height", n(height));
  rect.setAttribute("fill", createPaint(
    defs,
    options.backgroundOptions.color,
    options.backgroundOptions.gradient,
    `background-${instanceId}`,
    { x: 0, y: 0, width: options.width, height: options.height },
  ));
  svg.appendChild(rect);
}

function drawDotPath(
  parent: SVGElement,
  cells: Array<{ column: number; row: number }>,
  moduleSize: number,
  xOffset: number,
  yOffset: number,
  fill: string,
): void {
  if (!cells.length) return;
  const radius = moduleSize / 2;
  const pathData = cells.map(({ column, row }) => {
    const centerX = xOffset + (column + 0.5) * moduleSize;
    const centerY = yOffset + (row + 0.5) * moduleSize;
    return `M ${n(centerX - radius)} ${n(centerY)} A ${n(radius)} ${n(radius)} 0 1 0 ${n(centerX + radius)} ${n(centerY)} A ${n(radius)} ${n(radius)} 0 1 0 ${n(centerX - radius)} ${n(centerY)} Z`;
  }).join(" ");
  const path = svgElement(parent.ownerDocument, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", fill);
  path.setAttribute("data-qr-dot-path", "true");
  parent.appendChild(path);
}

function drawFinders(
  parent: SVGElement,
  defs: SVGElement,
  options: ResolvedOptions,
  count: number,
  moduleSize: number,
  xOffset: number,
  yOffset: number,
  instanceId: number | string,
): void {
  for (const [right, bottom, quarterTurns] of finderPattern) {
    const x = xOffset + right * moduleSize * (count - 7);
    const y = yOffset + bottom * moduleSize * (count - 7);
    const squareGradient = options.cornersSquareOptions?.gradient ??
      (options.cornersSquareOptions?.color === undefined
        ? options.dotsOptions.gradient
        : undefined);
    const dotGradient = options.cornersDotOptions?.gradient ??
      (options.cornersDotOptions?.color === undefined
        ? options.dotsOptions.gradient
        : undefined);
    const squareFill = createPaint(
      defs,
      options.cornersSquareOptions?.color ?? options.dotsOptions.color,
      squareGradient,
      `corner-square-${right}-${bottom}-${instanceId}`,
      options.cornersSquareOptions?.gradient
        ? {
          x,
          y,
          width: 7 * moduleSize,
          height: 7 * moduleSize,
          additionalRotation: quarterTurns * Math.PI / 2,
        }
        : { x: 0, y: 0, width: options.width, height: options.height },
    );
    const dotFill = createPaint(
      defs,
      options.cornersDotOptions?.color ?? options.dotsOptions.color,
      dotGradient,
      `corner-dot-${right}-${bottom}-${instanceId}`,
      options.cornersDotOptions?.gradient
        ? {
          x: x + 2 * moduleSize,
          y: y + 2 * moduleSize,
          width: 3 * moduleSize,
          height: 3 * moduleSize,
          additionalRotation: quarterTurns * Math.PI / 2,
        }
        : { x: 0, y: 0, width: options.width, height: options.height },
    );
    const outer = svgElement(parent.ownerDocument, "path");
    outer.setAttribute("d", finderRingPath(
      x,
      y,
      7 * moduleSize,
      moduleSize,
      options.cornersSquareOptions?.type ??
        moduleShapeToFinderFrame(options.dotsOptions.type),
    ));
    outer.setAttribute("fill", squareFill);
    outer.setAttribute("fill-rule", "evenodd");
    if (quarterTurns) {
      const centerX = x + 3.5 * moduleSize;
      const centerY = y + 3.5 * moduleSize;
      outer.setAttribute(
        "transform",
        `rotate(${quarterTurns * 90},${n(centerX)},${n(centerY)})`,
      );
    }
    parent.appendChild(outer);

    const inner = finderDot(
      parent.ownerDocument,
      x + 2 * moduleSize,
      y + 2 * moduleSize,
      3 * moduleSize,
      options.cornersDotOptions?.type ??
        moduleShapeToFinderCenter(options.dotsOptions.type),
    );
    inner.setAttribute("fill", dotFill);
    parent.appendChild(inner);
  }
}

function finderRingPath(
  x: number,
  y: number,
  size: number,
  moduleSize: number,
  type: FinderFrameShape,
): string {
  const radius = type === "circle"
    ? size / 2
    : type === "extra-rounded"
    ? 2.5 * moduleSize
    : type === "rounded"
    ? moduleSize
    : 0;
  return `${roundedRectPath(x, y, size, size, radius)} ${roundedRectPath(
    x + moduleSize,
    y + moduleSize,
    size - 2 * moduleSize,
    size - 2 * moduleSize,
    Math.max(0, radius - moduleSize),
  )}`;
}

function finderDot(
  document: Document,
  x: number,
  y: number,
  size: number,
  type: FinderCenterShape,
): SVGElement {
  if (type === "circle") {
    const circle = svgElement(document, "circle");
    circle.setAttribute("cx", n(x + size / 2));
    circle.setAttribute("cy", n(y + size / 2));
    circle.setAttribute("r", n(size / 2));
    return circle;
  }
  const rect = svgElement(document, "rect");
  rect.setAttribute("x", n(x));
  rect.setAttribute("y", n(y));
  rect.setAttribute("width", n(size));
  rect.setAttribute("height", n(size));
  if (type === "rounded") {
    rect.setAttribute("rx", n(size / 4));
  }
  return rect;
}

function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0) {
    return `M ${n(x)} ${n(y)} H ${n(x + width)} V ${n(y + height)} H ${n(x)} Z`;
  }
  return `M ${n(x + r)} ${n(y)} H ${n(x + width - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + width)} ${n(y + r)} V ${n(y + height - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + width - r)} ${n(y + height)} H ${n(x + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + height - r)} V ${n(y + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)} Z`;
}

function createPaint(
  defs: SVGElement,
  color: string,
  gradient: Gradient | undefined,
  id: string,
  bounds: PaintBounds,
): string {
  if (!gradient) return color;
  const element = svgElement(
    defs.ownerDocument,
    gradient.type === "radial" ? "radialGradient" : "linearGradient",
  );
  element.setAttribute("id", id);
  element.setAttribute("gradientUnits", "userSpaceOnUse");
  if (gradient.type === "radial") {
    element.setAttribute("fx", n(bounds.x + bounds.width / 2));
    element.setAttribute("fy", n(bounds.y + bounds.height / 2));
    element.setAttribute("cx", n(bounds.x + bounds.width / 2));
    element.setAttribute("cy", n(bounds.y + bounds.height / 2));
    element.setAttribute("r", n(Math.max(bounds.width, bounds.height) / 2));
  } else {
    const rotation = ((gradient.rotation ?? 0) +
      (bounds.additionalRotation ?? 0)) % (2 * Math.PI);
    const positiveRotation = (rotation + 2 * Math.PI) % (2 * Math.PI);
    let x1 = bounds.x + bounds.width / 2;
    let y1 = bounds.y + bounds.height / 2;
    let x2 = x1;
    let y2 = y1;

    if (positiveRotation <= Math.PI / 4 || positiveRotation > 7 * Math.PI / 4) {
      x1 -= bounds.width / 2;
      y1 -= bounds.height / 2 * Math.tan(rotation);
      x2 += bounds.width / 2;
      y2 += bounds.height / 2 * Math.tan(rotation);
    } else if (positiveRotation <= 3 * Math.PI / 4) {
      y1 -= bounds.height / 2;
      x1 -= bounds.width / 2 / Math.tan(rotation);
      y2 += bounds.height / 2;
      x2 += bounds.width / 2 / Math.tan(rotation);
    } else if (positiveRotation <= 5 * Math.PI / 4) {
      x1 += bounds.width / 2;
      y1 += bounds.height / 2 * Math.tan(rotation);
      x2 -= bounds.width / 2;
      y2 -= bounds.height / 2 * Math.tan(rotation);
    } else {
      y1 += bounds.height / 2;
      x1 += bounds.width / 2 / Math.tan(rotation);
      y2 -= bounds.height / 2;
      x2 -= bounds.width / 2 / Math.tan(rotation);
    }

    element.setAttribute("x1", n(Math.round(x1)));
    element.setAttribute("y1", n(Math.round(y1)));
    element.setAttribute("x2", n(Math.round(x2)));
    element.setAttribute("y2", n(Math.round(y2)));
  }
  for (const colorStop of gradient.colorStops) {
    const stop = svgElement(defs.ownerDocument, "stop");
    stop.setAttribute("offset", `${n(colorStop.offset * 100)}%`);
    stop.setAttribute("stop-color", colorStop.color);
    element.appendChild(stop);
  }
  defs.appendChild(element);
  return `url(#${id})`;
}

function isFinderModule(row: number, column: number, count: number): boolean {
  return (row < 7 && column < 7) ||
    (row < 7 && column >= count - 7) ||
    (row >= count - 7 && column < 7);
}

function isHiddenByLogo(
  row: number,
  column: number,
  count: number,
  logo: LogoLayout | undefined,
  options: ResolvedOptions,
): boolean {
  if (!logo || !options.imageOptions.hideBackgroundDots) return false;
  const firstRow = Math.ceil((count - logo.hideRows) / 2);
  const firstColumn = Math.ceil((count - logo.hideColumns) / 2);
  return row >= firstRow && row < firstRow + logo.hideRows &&
    column >= firstColumn && column < firstColumn + logo.hideColumns;
}

function loadLogo(
  window: RuntimeWindow,
  source: string,
  crossOrigin: string | undefined,
  saveAsBlob: boolean,
  imageStore: ImageResourceStore | undefined,
): Promise<LoadedLogo> {
  const loadImage = (href: string) => new Promise<LoadedLogo>((resolve, reject) => {
    const image = new window.Image();
    if (crossOrigin) image.crossOrigin = crossOrigin;
    image.onload = () => resolve({
      height: image.naturalHeight || image.height,
      href: saveAsBlob ? image.src : source,
      width: image.naturalWidth || image.width,
    });
    image.onerror = (event) => {
      const cause = (event as Event & { error?: unknown }).error;
      reject(cause instanceof Error
        ? cause
        : new Error(`Unable to load QR image: ${source}`));
    };
    image.src = href;
  });

  if (!saveAsBlob || !imageStore) return loadImage(source);
  const resolvedSource = source.startsWith("data:")
    ? source
    : new URL(source, window.document.baseURI).href;
  return imageStore.load(resolvedSource).then((resource) => loadImage(resource.dataUrl));
}

function calculateLogoLayout(
  logo: LoadedLogo,
  options: ResolvedOptions,
  count: number,
  moduleSize: number,
  xOffset: number,
  yOffset: number,
): LogoLayout {
  const maxHidden = Math.floor(
    options.imageOptions.imageSize *
      errorCorrectionPercent[options.qrOptions.errorCorrectionLevel] * count * count,
  );
  const calculated = calculateImageSize({
    originalHeight: logo.height,
    originalWidth: logo.width,
    maxHiddenDots: maxHidden,
    maxHiddenAxisDots: Math.max(1, count - 14),
    dotSize: moduleSize,
  });
  const hideColumns = calculated.hideXDots;
  const hideRows = calculated.hideYDots;
  const boxWidth = calculated.width;
  const boxHeight = calculated.height;
  const renderedWidth = Math.max(0, boxWidth - 2 * options.imageOptions.margin);
  const renderedHeight = Math.max(0, boxHeight - 2 * options.imageOptions.margin);
  return {
    ...logo,
    hideColumns,
    hideRows,
    renderedHeight,
    renderedWidth,
    x: xOffset + (count * moduleSize - boxWidth) / 2 + options.imageOptions.margin,
    y: yOffset + (count * moduleSize - boxHeight) / 2 + options.imageOptions.margin,
  };
}

function drawLogo(
  svg: SVGElement,
  defs: SVGElement,
  logo: LogoLayout,
  options: ResolvedOptions,
  instanceId: number | string,
): void {
  const shape = options.imageOptions.shape;
  if (options.imageOptions.backgroundColor) {
    const padding = options.imageOptions.margin;
    const plateX = logo.x - padding;
    const plateY = logo.y - padding;
    const plateWidth = logo.renderedWidth + 2 * padding;
    const plateHeight = logo.renderedHeight + 2 * padding;
    const plate = shape === "circle"
      ? svgElement(svg.ownerDocument, "circle")
      : svgElement(svg.ownerDocument, "rect");
    if (shape === "circle") {
      plate.setAttribute("cx", n(plateX + plateWidth / 2));
      plate.setAttribute("cy", n(plateY + plateHeight / 2));
      plate.setAttribute("r", n(Math.max(plateWidth, plateHeight) / 2));
    } else {
      plate.setAttribute("x", n(plateX));
      plate.setAttribute("y", n(plateY));
      plate.setAttribute("width", n(plateWidth));
      plate.setAttribute("height", n(plateHeight));
      if (shape === "rounded") {
        plate.setAttribute("rx", n(Math.min(plateWidth, plateHeight) / 4));
      }
    }
    plate.setAttribute("fill", options.imageOptions.backgroundColor);
    plate.setAttribute("data-qr-logo-background", "true");
    svg.appendChild(plate);
  }

  const image = svgElement(svg.ownerDocument, "image");
  svg.setAttribute("xmlns:xlink", XLINK_NAMESPACE);
  image.setAttribute("href", logo.href);
  image.setAttribute("xlink:href", logo.href);
  image.setAttribute("x", n(logo.x));
  image.setAttribute("y", n(logo.y));
  image.setAttribute("width", n(logo.renderedWidth));
  image.setAttribute("height", n(logo.renderedHeight));
  image.setAttribute("preserveAspectRatio", "xMidYMid meet");
  image.setAttribute("opacity", n(options.imageOptions.opacity));
  if (shape !== "square") {
    const clipId = `qr-logo-${instanceId}`;
    const clip = svgElement(svg.ownerDocument, "clipPath");
    clip.setAttribute("id", clipId);
    const clipShape = shape === "circle"
      ? svgElement(svg.ownerDocument, "ellipse")
      : svgElement(svg.ownerDocument, "rect");
    if (shape === "circle") {
      clipShape.setAttribute("cx", n(logo.x + logo.renderedWidth / 2));
      clipShape.setAttribute("cy", n(logo.y + logo.renderedHeight / 2));
      clipShape.setAttribute("rx", n(logo.renderedWidth / 2));
      clipShape.setAttribute("ry", n(logo.renderedHeight / 2));
    } else {
      clipShape.setAttribute("x", n(logo.x));
      clipShape.setAttribute("y", n(logo.y));
      clipShape.setAttribute("width", n(logo.renderedWidth));
      clipShape.setAttribute("height", n(logo.renderedHeight));
      clipShape.setAttribute("rx", n(Math.min(logo.renderedWidth, logo.renderedHeight) / 4));
    }
    clip.appendChild(clipShape);
    defs.appendChild(clip);
    image.setAttribute("clip-path", `url(#${clipId})`);
  }
  if (options.imageOptions.crossOrigin) {
    image.setAttribute("crossorigin", options.imageOptions.crossOrigin);
  }
  svg.appendChild(image);
}

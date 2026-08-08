const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SEAM_OVERLAP_ATTRIBUTE = "data-qr-seam-overlap";
const SEAM_COPY_ATTRIBUTE = "data-qr-seam-copy";
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
): void {
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  normalizeSvgCoordinates(svg);
  if (seamOverlap <= 0) return;

  const multiShapeClipPathIds = new Set(
    Array.from(svg.querySelectorAll("clipPath"))
      .filter((clipPath) => clipPath.children.length > 1)
      .map((clipPath) => clipPath.getAttribute("id"))
      .filter((id): id is string => Boolean(id)),
  );

  for (const element of svg.querySelectorAll("[clip-path]")) {
    if (element.hasAttribute(SEAM_OVERLAP_ATTRIBUTE)) continue;

    const clipPathId = parseClipPathId(element.getAttribute("clip-path"));
    if (!clipPathId || !multiShapeClipPathIds.has(clipPathId)) continue;

    const parent = element.parentNode;
    if (!parent) continue;

    const translations: Array<[number, number]> = [
      [-seamOverlap, 0],
      [seamOverlap, 0],
      [0, -seamOverlap],
      [0, seamOverlap],
    ];
    const existingTransform = element.getAttribute("transform");

    for (const [x, y] of translations) {
      const copy = element.cloneNode(true) as Element;
      copy.removeAttribute("id");
      copy.setAttribute(SEAM_COPY_ATTRIBUTE, `${x},${y}`);
      copy.setAttribute(
        "transform",
        `translate(${x} ${y})${existingTransform ? ` ${existingTransform}` : ""}`,
      );
      parent.insertBefore(copy, element);
    }

    element.setAttribute(SEAM_OVERLAP_ATTRIBUTE, String(seamOverlap));
  }
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

function parseClipPathId(value: string | null): string | undefined {
  if (!value) return undefined;
  return /^url\(["']?#([^"')]+)["']?\)$/.exec(value)?.[1];
}

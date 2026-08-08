import type { Options, QRCode } from "./types.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
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
   * Compatibility option retained from the Worker port. The independent
   * contour renderer has no shared edges to overlap; a positive value is
   * recorded on the contour for diagnostics and fallback consumers.
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

/**
 * Backward-compatible utility for callers that used the old port hook.
 * Topology rendering now happens before serialization, so post-processing
 * only needs to make the SVG standalone and normalize numeric geometry.
 */
export function applySvgRenderingFixes(
  svg: SVGElement,
  seamOverlap: number,
  matrix?: QRCode,
  options?: Options,
): void {
  void seamOverlap;
  void matrix;
  void options;
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  normalizeSvgCoordinates(svg);
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
    return formatSvgNumber(number);
  });
}

/** Formats generated SVG geometry without leaking binary floating-point tails. */
export function formatSvgNumber(value: number): string {
  const rounded = Math.round(value * SVG_NUMBER_FACTOR) / SVG_NUMBER_FACTOR;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

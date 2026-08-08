import { describe, expect, it } from "vitest";
import { buildContourPath, type ContourOptions } from "../src/qr-contour.js";

const cells = [
  { column: 0, row: 0 },
  { column: 1, row: 0 },
];

function contourOptions(
  type: string,
  selected = cells,
  moduleSize = 10,
): ContourOptions {
  const drawn = new Set(selected.map(({ column, row }) => `${row},${column}`));
  return {
    count: 20,
    isDrawn: (row, column) => drawn.has(`${row},${column}`),
    moduleSize,
    seamOverlap: 0.2,
    type,
    xOffset: 0,
    yOffset: 0,
  };
}

describe("QR-specific contour tracing", () => {
  it("turns adjacent square modules into one outer contour", () => {
    const pathData = buildContourPath(cells, contourOptions("square")) ?? "";
    expect(pathData.match(/\bM\s/g)).toHaveLength(1);
    expect(pathData).not.toMatch(/L 10 0 L 10 10|L 10 10 L 10 0/);
  });

  it("rounds only the exposed ends of a connected run", () => {
    const pathData = buildContourPath(cells, contourOptions("rounded")) ?? "";
    expect(pathData.match(/A 5 5/g)).toHaveLength(4);
    expect(pathData.match(/\bM\s/g)).toHaveLength(1);
  });

  it("removes collinear module vertices from straight runs", () => {
    const run = Array.from({ length: 12 }, (_, column) => ({ column, row: 0 }));
    const pathData = buildContourPath(run, contourOptions("square", run)) ?? "";

    expect(pathData).toBe("M 0 0 L 120 0 L 120 10 L 0 10 Z");
  });

  it.each([
    ["isolated", [{ row: 1, column: 1 }], 1],
    ["vertical run", [{ row: 0, column: 0 }, { row: 1, column: 0 }], 1],
    ["L", [{ row: 0, column: 0 }, { row: 1, column: 0 }, { row: 1, column: 1 }], 1],
    ["T", [
      { row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 },
      { row: 1, column: 1 },
    ], 1],
    ["cross", [
      { row: 0, column: 1 }, { row: 1, column: 0 }, { row: 1, column: 1 },
      { row: 1, column: 2 }, { row: 2, column: 1 },
    ], 1],
    ["block", [
      { row: 0, column: 0 }, { row: 0, column: 1 },
      { row: 1, column: 0 }, { row: 1, column: 1 },
    ], 1],
    ["ring with a hole", [
      { row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 },
      { row: 1, column: 0 }, { row: 1, column: 2 },
      { row: 2, column: 0 }, { row: 2, column: 1 }, { row: 2, column: 2 },
    ], 2],
    ["logo-like cutout", [
      { row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 }, { row: 0, column: 3 },
      { row: 1, column: 0 }, { row: 1, column: 3 },
      { row: 2, column: 0 }, { row: 2, column: 3 },
      { row: 3, column: 0 }, { row: 3, column: 1 }, { row: 3, column: 2 }, { row: 3, column: 3 },
    ], 2],
  ])("traces %s topology into the expected contour count", (_, selected, contours) => {
    const pathData = buildContourPath(selected, contourOptions("rounded", selected, 3.2)) ?? "";

    expect(pathData.match(/\bM\s/g)).toHaveLength(contours);
    expect(pathData.match(/\bZ\b/g)).toHaveLength(contours);
    expect(pathData).not.toMatch(/(?:NaN|Infinity|\d+\.\d{7,})/);
  });
});

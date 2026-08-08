import { describe, expect, it } from "vitest";
import QRCodeStyling, {
  calculateImageSize,
  cornerDotTypes,
  cornerSquareTypes,
  dotTypes,
  errorCorrectionLevels,
  errorCorrectionPercents,
  getMode,
  finderCenterShapes,
  finderFrameShapes,
  mergeDeep,
  moduleShapes,
  modes,
  parseFinderCenterShape,
  parseFinderFrameShape,
  parseModuleShape,
  qrTypes,
} from "../src/index.js";

describe("public API compatibility", () => {
  it("exports the compatible constants and default class", () => {
    expect(moduleShapes.circle).toBe("circle");
    expect(moduleShapes.diagonalRounded).toBe("diagonal-rounded");
    expect(moduleShapes.diagonalExtraRounded).toBe("diagonal-extra-rounded");
    expect(finderFrameShapes.circle).toBe("circle");
    expect(finderCenterShapes.circle).toBe("circle");
    expect(Object.keys(dotTypes)).toEqual([
      "dots",
      "rounded",
      "classy",
      "classyRounded",
      "square",
      "extraRounded",
    ]);
    expect(Object.keys(cornerSquareTypes)).toEqual([
      "dot",
      "square",
      "extraRounded",
    ]);
    expect(Object.keys(cornerDotTypes)).toEqual(["dot", "square"]);
    for (const [key, value] of Object.entries(errorCorrectionLevels)) {
      expect(key).toBe(value);
    }
    expect(Object.keys(errorCorrectionPercents)).toEqual(["L", "M", "Q", "H"]);
    expect(Object.values(modes).every((value) => typeof value === "string")).toBe(true);
    expect(Object.keys(qrTypes)).toHaveLength(41);
    for (const [key, value] of Object.entries(qrTypes)) expect(Number(key)).toBe(value);
    expect(typeof QRCodeStyling).toBe("function");
  });

  it("parses canonical and legacy shape names through one public boundary", () => {
    expect(parseModuleShape("dots")).toBe("circle");
    expect(parseModuleShape("diagonal-rounded")).toBe("diagonal-rounded");
    expect(parseFinderFrameShape("dot")).toBe("circle");
    expect(parseFinderCenterShape("dot")).toBe("circle");
    expect(parseModuleShape("unsupported-shape")).toBeUndefined();
    expect(parseFinderFrameShape("classy")).toBeUndefined();
  });

  it("rejects unsupported runtime shape values", () => {
    expect(() => new QRCodeStyling({
      data: "invalid-shape",
      dotsOptions: { type: "unsupported-shape" as never },
    })).toThrow(/Unsupported module shape/);
  });

  it.each([
    ["dots", "circle"],
    ["classy", "diagonal-rounded"],
    ["classy-rounded", "diagonal-extra-rounded"],
  ] as const)("normalizes legacy module shape %s to %s", async (legacy, canonical) => {
    const options = { data: "shape-alias", type: "svg" as const };
    const legacySvg = await new QRCodeStyling({
      ...options,
      dotsOptions: { type: legacy },
    }).getSvgString();
    const canonicalSvg = await new QRCodeStyling({
      ...options,
      dotsOptions: { type: canonical },
    }).getSvgString();

    expect(legacySvg).toBe(canonicalSvg);
  });

  it("normalizes legacy finder names without changing their output", async () => {
    const options = { data: "finder-alias", type: "svg" as const };
    const legacySvg = await new QRCodeStyling({
      ...options,
      cornersSquareOptions: { type: "dot" },
      cornersDotOptions: { type: "dot" },
    }).getSvgString();
    const canonicalSvg = await new QRCodeStyling({
      ...options,
      cornersSquareOptions: { type: "circle" },
      cornersDotOptions: { type: "circle" },
    }).getSvgString();

    expect(legacySvg).toBe(canonicalSvg);
  });

  it("renders with compatible public defaults", async () => {
    const qr = new QRCodeStyling({ data: "defaults", type: "svg" });
    const svg = await qr.getSvgString();

    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="300"');
    expect(svg).toContain('viewBox="0 0 300 300"');
    expect(svg).toContain('fill="#fff"');
  });

  it("does not expose implementation fields", () => {
    const qr = new QRCodeStyling({ data: "private-state", type: "svg" });
    const instance = qr as unknown as Record<string, unknown>;

    expect(instance._options).toBeUndefined();
    expect(instance._qr).toBeUndefined();
    expect(instance._getElement).toBeUndefined();
    expect(instance._setupSvg).toBeUndefined();
  });

  it.each([
    [123, "Numeric"],
    ["123", "Numeric"],
    ["01ABCZ$%*+-./:", "Alphanumeric"],
    ["01ABCZ./:!@#$%^&*()_+", "Byte"],
    ["абвАБВ", "Byte"],
  ] as const)("detects the compatible mode for %s", (input, expected) => {
    expect(getMode(input)).toBe(expected);
  });

  it.each([
    [{ originalHeight: 0, originalWidth: 0, maxHiddenDots: 0, dotSize: 0 }, [0, 0, 0, 0]],
    [{ originalHeight: -1, originalWidth: 5, maxHiddenDots: 11, dotSize: -5 }, [0, 0, 0, 0]],
    [{ originalHeight: 20, originalWidth: 10, maxHiddenDots: 1, dotSize: 10 }, [10, 5, 1, 1]],
    [{ originalHeight: 10, originalWidth: 20, maxHiddenDots: 1, dotSize: 10 }, [5, 10, 1, 1]],
    [{ originalHeight: 1000, originalWidth: 2020, maxHiddenDots: 50, dotSize: 10 }, [45, 90, 5, 9]],
    [{ originalHeight: 1000, originalWidth: 2020, maxHiddenDots: 50, dotSize: 10, maxHiddenAxisDots: 1 }, [5, 10, 1, 1]],
    [{ originalHeight: 2020, originalWidth: 1000, maxHiddenDots: 50, dotSize: 10, maxHiddenAxisDots: 1 }, [10, 5, 1, 1]],
    [{ originalHeight: 2020, originalWidth: 1000, maxHiddenDots: 50, dotSize: 10, maxHiddenAxisDots: 2 }, [20, 10, 2, 1]],
  ] as const)("matches the compatible logo sizing case %#", (input, expected) => {
    const result = calculateImageSize(input);
    expect([result.height, result.width, result.hideYDots, result.hideXDots])
      .toEqual(expected);
  });

  it("matches compatible deep merge semantics", () => {
    const target = { obj: { foo: "foo", arr: [1, 2] }, str: "foo" };
    const result = mergeDeep(target, { obj: { bar: "bar" } }, {
      obj: { arr: [3, 4] },
      str: "bar",
    });
    expect(result).toEqual({
      obj: { foo: "foo", bar: "bar", arr: [3, 4] },
      str: "bar",
    });
    expect(result).not.toBe(target);
    expect(mergeDeep(target, undefined)).toBe(target);
    expect(mergeDeep([1, 2] as unknown as Record<string, unknown>, {
      0: 3,
    })).toEqual([1, 2]);
  });

  it("validates the mask extension through the public constructor", () => {
    const payload = "https://tools.tf/mask";
    expect(() => new QRCodeStyling({
      data: payload,
      qrOptions: { mask: 8 as never },
    })).toThrow(/Invalid mask/);
  });

  it("rejects a non-DOM append target", () => {
    const qr = new QRCodeStyling({ data: "append-target", type: "svg" });
    expect(() => qr.append({} as HTMLElement)).toThrow(/single DOM node/);
  });

  it("rejects the unsupported upstream nodeCanvas option", () => {
    expect(() => new QRCodeStyling({
      data: "node-canvas",
      nodeCanvas: {} as never,
    } as never)).toThrow(/nodeCanvas is not supported/);
  });
});

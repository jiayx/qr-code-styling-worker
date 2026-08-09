import { parseHTML } from "linkedom/worker";
import { describe, expect, it, vi } from "vitest";
import QRCodeStyling, {
  cornerDotTypes,
  cornerSquareTypes,
  dotTypes,
  gradientTypes,
  normalizeSvgNumericValue,
  shapeTypes,
} from "../src/index.js";

const logo =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='12'%3E%3Crect width='20' height='12' fill='red'/%3E%3C/svg%3E";

function getSvgDocument(svg: string): Document {
  return parseHTML(svg).document as unknown as Document;
}

describe("SVG rendering in workerd", () => {
  it("uses compatible constructor defaults without browser globals", async () => {
    const qr = new QRCodeStyling({ data: "https://example.com" });
    const blob = await qr.getRawData("svg");

    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe("image/svg+xml");
    const document = getSvgDocument(await blob?.text() ?? "");
    expect(document.querySelector("svg")?.getAttribute("xmlns")).toBe(
      "http://www.w3.org/2000/svg",
    );
  });

  it("traces data modules as connected QR contours", async () => {
    const qr = new QRCodeStyling({
      data: "https://tools.tf",
      height: 320,
      margin: 48,
      svgOptions: { seamOverlap: 0.2 },
      type: "svg",
      width: 320,
      dotsOptions: {
        roundSize: false,
        type: "extra-rounded",
      },
    });
    const svg = await qr.getSvgString();

    expect(svg).not.toContain("data-qr-seam-overlap");
    expect(svg).toContain('data-qr-contour-path="true"');
    expect(svg).toContain('data-qr-contour-layer="true"');
    expect(svg).not.toContain("data-qr-seam-bridge");
    expect(svg).not.toContain("data-qr-seam-layer");
    expect(svg).toContain('shape-rendering="geometricPrecision"');
    expect(svg).not.toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('viewBox="0 0 320 320"');
    expect(svg).not.toMatch(/\d+\.\d{7,}/);
    const document = getSvgDocument(svg);
    expect(document.querySelector('clipPath[id^="clip-path-dot-color-"]')).toBeNull();
    expect(document.querySelector('[data-qr-contour-layer="true"]')?.tagName.toLowerCase())
      .toBe("path");
  });

  it("keeps the representative contour SVG compact", async () => {
    const qr = new QRCodeStyling({
      data: "https://tools.tf",
      width: 320,
      height: 320,
      margin: 48,
      dotsOptions: {
        type: "extra-rounded",
        gradient: {
          type: "linear",
          colorStops: [
            { offset: 0, color: "#65a30d" },
            { offset: 1, color: "#365314" },
          ],
        },
      },
      cornersSquareOptions: { type: "extra-rounded" },
      cornersDotOptions: { type: "square" },
      type: "svg",
    });
    const svg = await qr.getSvgString();
    const document = getSvgDocument(svg);
    const contour = document.querySelector('[data-qr-contour-path="true"]');

    expect(svg.length).toBeLessThan(10_000);
    expect(document.querySelectorAll("path").length).toBeLessThanOrEqual(4);
    expect(document.querySelectorAll("clipPath")).toHaveLength(0);
    expect(contour?.getAttribute("d")).not.toContain(" L ");
  });

  it("renders every compatible data-dot family", async () => {
    for (const type of Object.values(dotTypes)) {
      const qr = new QRCodeStyling({
        data: `compound-${type}`,
        dotsOptions: { roundSize: false, type },
        svgOptions: { seamOverlap: 0.2 },
        type: "svg",
      });
      const document = getSvgDocument(await qr.getSvgString());
      if (type === "dots") {
        expect(document.querySelector('[data-qr-dot-path="true"]'), type)
          .not.toBeNull();
        expect(document.querySelectorAll('[data-qr-dot-path="true"]'), type)
          .toHaveLength(1);
        expect(document.querySelector('[data-qr-contour-path="true"]'), type)
          .toBeNull();
      } else {
        expect(document.querySelector('clipPath[id^="clip-path-dot-color-"]'), type)
          .toBeNull();
        expect(document.querySelector('[data-qr-contour-path="true"]'), type)
          .not.toBeNull();
      }
    }
  });

  it("normalizes SVG geometry without touching path commands", () => {
    expect(normalizeSvgNumericValue(
      "rotate(90,194.55999999999997,33.28)",
    )).toBe("rotate(90,194.56,33.28)");
    expect(normalizeSvgNumericValue(
      "M 188.79999999999998 0.00000001L -0.00000001 2",
    )).toBe("M 188.8 0L 0 2");
  });

  it("does not add overlap when roundSize remains enabled", async () => {
    const qr = new QRCodeStyling({
      data: "integer-modules",
      svgOptions: { seamOverlap: 0.2 },
      type: "svg",
    });

    expect(await qr.getSvgString()).not.toContain("data-qr-seam-overlap");
  });

  it("floors module offsets when roundSize is enabled", async () => {
    const qr = new QRCodeStyling({
      data: "offset",
      width: 301,
      height: 303,
      qrOptions: { typeNumber: 1 },
      dotsOptions: { roundSize: true },
      cornersSquareOptions: { type: "square" },
      type: "svg",
    });
    const document = getSvgDocument(await qr.getSvgString());
    const paths = document.querySelectorAll('[data-qr-layer="true"] > path');

    expect(paths[1]?.getAttribute("d")).toMatch(/^M 3 4 H /);
  });

  it("combines intentionally separate dots into one compound path", async () => {
    const dots = new QRCodeStyling({
      data: "separate-dots",
      dotsOptions: { roundSize: false, type: "dots" },
      svgOptions: { seamOverlap: 0.2 },
      type: "svg",
    });
    const svg = await dots.getSvgString();
    expect(svg).not.toContain("data-qr-seam-bridge");
    expect(svg).not.toContain('data-qr-contour-path="true"');
    expect(svg).toContain('data-qr-dot-path="true"');
    expect(getSvgDocument(svg).querySelectorAll('[data-qr-dot-path="true"]'))
      .toHaveLength(1);
    expect(svg).not.toContain("<clipPath");
  });

  it("preserves hidden modules around an embedded logo", async () => {
    const qr = new QRCodeStyling({
      data: "logo-safe",
      dotsOptions: { roundSize: false, type: "rounded" },
      image: logo,
      imageOptions: { hideBackgroundDots: true, imageSize: 0.3, margin: 2 },
      svgOptions: { seamOverlap: 0.2 },
      type: "svg",
    });
    const svg = await qr.getSvgString();

    expect(svg).toContain("<image");
    expect(svg).toContain('data-qr-contour-path="true"');
    expect(svg).not.toContain("data-qr-seam-bridge");
  });

  it("validates but otherwise ignores seam overlap", async () => {
    expect(() => new QRCodeStyling({
      data: "invalid-overlap",
      svgOptions: { seamOverlap: 0.6 },
    })).toThrow(/between 0 and 0.5/);

    const qr = new QRCodeStyling({
      data: "updated-overlap",
      dotsOptions: { roundSize: false },
      svgOptions: { seamOverlap: 0 },
      type: "svg",
    });
    qr.update({ svgOptions: { seamOverlap: 0.1 } });

    expect(await qr.getSvgString()).not.toContain("data-qr-seam-overlap");
  });

  it("supports every figure family, gradients, image, shape and update", async () => {
    const qr = new QRCodeStyling({
      data: "all-options",
      image: logo,
      shape: "circle",
      dotsOptions: {
        type: "classy-rounded",
        gradient: {
          type: "radial",
          rotation: 0.4,
          colorStops: [
            { offset: 0, color: "#123456" },
            { offset: 1, color: "#abcdef" },
          ],
        },
      },
      cornersSquareOptions: { type: "extra-rounded", color: "#0000ff" },
      cornersDotOptions: { type: "dot", color: "#ff0000" },
      backgroundOptions: { color: "#ffffff" },
      imageOptions: { hideBackgroundDots: true, imageSize: 0.3, margin: 2 },
      qrOptions: { errorCorrectionLevel: "H", mode: "Byte", typeNumber: 0 },
    });

    qr.update({ width: 420, height: 420, margin: 8 });
    const svg = await qr.getSvgString();

    expect(svg).toContain("<radialGradient");
    expect(svg).toContain("<image");
    expect(svg).toContain('width="420"');
    expect(svg).not.toContain("<clipPath");
    const circleDecorationCount = getSvgDocument(svg)
      .querySelector('[data-qr-layer="true"]')
      ?.getAttribute("data-qr-circle-decoration-count");
    expect(Number(circleDecorationCount)).toBeGreaterThan(0);
  });

  it("omits unused definitions and legacy xlink attributes", async () => {
    const plain = new QRCodeStyling({
      data: "plain-solid-svg",
      type: "svg",
    });
    const svg = await plain.getSvgString();

    expect(svg).not.toContain("<defs");
    expect(svg).not.toContain("xmlns:xlink");

    const withLogo = await new QRCodeStyling({
      data: "single-logo-reference",
      image: logo,
      type: "svg",
    }).getSvgString();
    expect(withLogo.match(/data:image\/svg\+xml;base64,/g)).toHaveLength(1);
    expect(withLogo).not.toContain("xlink:href");
  });

  it("clears a gradient when update explicitly passes undefined", async () => {
    const qr = new QRCodeStyling({
      data: "gradient-update",
      dotsOptions: {
        gradient: {
          type: "linear",
          colorStops: [
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
          ],
        },
      },
      type: "svg",
    });
    expect(await qr.getSvgString()).toContain("<linearGradient");

    qr.update({ dotsOptions: { gradient: undefined } });
    expect(await qr.getSvgString()).not.toContain("<linearGradient");
  });

  it("matches compatible gradient coordinates and finder rotations", async () => {
    const qr = new QRCodeStyling({
      data: "gradient-geometry",
      width: 320,
      height: 240,
      dotsOptions: {
        gradient: {
          type: "linear",
          rotation: 0,
          colorStops: [
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
          ],
        },
      },
      cornersSquareOptions: { type: "rounded" },
      type: "svg",
    });
    const document = getSvgDocument(await qr.getSvgString());
    const gradient = document.querySelector('linearGradient[id^="dots-"]');
    const finderPaths = document.querySelectorAll('[data-qr-layer="true"] > path');

    expect(gradient?.getAttribute("x1")).toBe("0");
    expect(gradient?.getAttribute("y1")).toBe("120");
    expect(gradient?.getAttribute("x2")).toBe("320");
    expect(gradient?.getAttribute("y2")).toBe("120");
    expect(finderPaths[1]?.getAttribute("transform")).toBeNull();
    expect(finderPaths[2]?.getAttribute("transform")).toMatch(/^rotate\(90,/);
    expect(finderPaths[3]?.getAttribute("transform")).toMatch(/^rotate\(-90,/);

    const angledDocument = getSvgDocument(await new QRCodeStyling({
      data: "fractional-gradient-geometry",
      width: 321,
      height: 239,
      dotsOptions: {
        gradient: {
          type: "linear",
          rotation: 0.37,
          colorStops: [
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
          ],
        },
      },
      type: "svg",
    }).getSvgString());
    const angled = angledDocument.querySelector('linearGradient[id^="dots-"]');
    const coordinates = ["x1", "y1", "x2", "y2"]
      .map((attribute) => angled?.getAttribute(attribute) ?? "");
    expect(coordinates.some((coordinate) => coordinate.includes("."))).toBe(true);
    expect(coordinates.join(" ")).not.toMatch(/\d+\.\d{7,}/);
  });

  it("lets an explicit finder color override the data gradient", async () => {
    const qr = new QRCodeStyling({
      data: "finder-color",
      dotsOptions: {
        gradient: {
          type: "linear",
          colorStops: [
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
          ],
        },
      },
      cornersSquareOptions: { color: "#ff0000" },
      type: "svg",
    });
    const document = getSvgDocument(await qr.getSvgString());
    const finderPaths = document.querySelectorAll('[data-qr-layer="true"] > path');

    expect(finderPaths[1]?.getAttribute("fill")).toBe("#ff0000");
  });

  it("keeps the extension hook usable with the Worker DOM", async () => {
    const qr = new QRCodeStyling({
      data: "extension",
      type: "svg",
    });
    qr.applyExtension((svg) => {
      const title = svg.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "title",
      );
      title.textContent = "worker-generated";
      svg.appendChild(title);
    });

    expect(await qr.getSvgString()).toContain("<title>worker-generated</title>");
    qr.deleteExtension();
    expect(await qr.getSvgString()).not.toContain("worker-generated");
  });

  it("fetches and embeds a remote logo once", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("<svg xmlns='http://www.w3.org/2000/svg' width='18' height='9'/>", {
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const qr = new QRCodeStyling({
      data: "remote-image",
      image: "https://assets.example/logo.svg",
      resourceOptions: { fetch: fetchMock },
      type: "svg",
    });

    expect(await qr.getSvgString()).toContain("data:image/svg+xml;base64,");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a remote logo URL when saveAsBlob is disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("<svg xmlns='http://www.w3.org/2000/svg' width='18' height='9'/>", {
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const source = "https://assets.example/logo.svg";
    const qr = new QRCodeStyling({
      data: "remote-image-reference",
      image: source,
      imageOptions: { saveAsBlob: false },
      resourceOptions: { fetch: fetchMock },
      type: "svg",
    });
    const document = getSvgDocument(await qr.getSvgString());

    expect(document.querySelector("image")?.getAttribute("href")).toBe(source);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("centers a rounded background on a non-square canvas", async () => {
    const qr = new QRCodeStyling({
      data: "rounded-background",
      width: 420,
      height: 300,
      backgroundOptions: { round: 0.5 },
      type: "svg",
    });
    const background = getSvgDocument(await qr.getSvgString()).querySelector("svg > rect");

    expect(background?.getAttribute("x")).toBe("60");
    expect(background?.getAttribute("y")).toBe("0");
    expect(background?.getAttribute("width")).toBe("300");
    expect(background?.getAttribute("height")).toBe("300");
    expect(background?.getAttribute("rx")).toBe("75");
  });

  it("validates gradients like the compatible API", () => {
    expect(() => new QRCodeStyling({
      data: "invalid-gradient",
      dotsOptions: {
        gradient: { type: "linear", colorStops: [] },
      },
    })).toThrow(/colorStops/);
  });

  it("surfaces image failures instead of hanging", async () => {
    const qr = new QRCodeStyling({
      data: "broken-image",
      image: "https://assets.example/missing.png",
      resourceOptions: {
        fetch: async () => new Response("missing", { status: 404 }),
      },
      type: "svg",
    });

    await expect(qr.getRawData("svg")).rejects.toThrow(/404/);
  });

  it("accepts but ignores the deprecated jsdom option", async () => {
    const qr = new QRCodeStyling({
      data: "ignored-jsdom",
      jsdom: class {
        readonly window = {};
        constructor() {
          throw new Error("must not be constructed");
        }
      },
      type: "svg",
    });

    expect(await qr.getSvgString()).toContain("<svg");
  });

  it("rejects raster output without a Cloudflare Images adapter", async () => {
    const qr = new QRCodeStyling({ data: "svg-only" });
    await expect(qr.getRawData("png")).rejects.toThrow(
      /createCloudflareCanvas/,
    );
  });

  it("exports runtime constants matching the public option unions", () => {
    expect(Object.values(dotTypes)).toEqual([
      "dots",
      "rounded",
      "classy",
      "classy-rounded",
      "square",
      "extra-rounded",
    ]);
    expect(Object.values(cornerSquareTypes)).toEqual([
      "dot",
      "square",
      "extra-rounded",
    ]);
    expect(Object.values(cornerDotTypes)).toEqual(["dot", "square"]);
    expect(Object.values(gradientTypes)).toEqual(["radial", "linear"]);
    expect(Object.values(shapeTypes)).toEqual(["square", "circle"]);
  });

  it("renders every declared dot and corner style", async () => {
    for (const type of Object.values(dotTypes)) {
      const qr = new QRCodeStyling({
        data: `dot-${type}`,
        type: "svg",
        dotsOptions: { type },
      });
      expect(await qr.getSvgString()).toContain("<svg");
    }

    for (const type of Object.values(cornerSquareTypes)) {
      const qr = new QRCodeStyling({
        data: `corner-square-${type}`,
        type: "svg",
        cornersSquareOptions: { type },
      });
      expect(await qr.getSvgString()).toContain("<svg");
    }

    for (const type of Object.values(cornerDotTypes)) {
      const qr = new QRCodeStyling({
        data: `corner-dot-${type}`,
        type: "svg",
        cornersDotOptions: { type },
      });
      expect(await qr.getSvgString()).toContain("<svg");
    }
  });
});

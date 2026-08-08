import { describe, expect, it, vi } from "vitest";
import QRCodeStyling, {
  cornerDotTypes,
  cornerSquareTypes,
  createWorkerJSDOM,
  dotTypes,
  gradientTypes,
  normalizeSvgNumericValue,
  shapeTypes,
} from "../src/index.js";

const logo =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='12'%3E%3Crect width='20' height='12' fill='red'/%3E%3C/svg%3E";

describe("SVG rendering in workerd", () => {
  it("uses the upstream-compatible default constructor without browser globals", async () => {
    const qr = new QRCodeStyling({ data: "https://example.com" });
    const blob = await qr.getRawData("svg");

    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe("image/svg+xml");
    expect(await blob?.text()).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg"',
    );
  });

  it("overlaps fractional clip paths without rounding module size", async () => {
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

    expect(svg).toContain('data-qr-seam-overlap="0.2"');
    expect(svg.match(/data-qr-seam-copy=/g)).toHaveLength(4);
    expect(svg).toContain('transform="translate(-0.2 0)"');
    expect(svg).toContain('transform="translate(0 0.2)"');
    expect(svg).not.toContain('stroke-width="0.4"');
    expect(svg).toContain('viewBox="0 0 320 320"');
    expect(svg).not.toMatch(/\d+\.\d{7,}/);
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

  it("validates and updates seam overlap", async () => {
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

    expect(await qr.getSvgString()).toContain(
      'data-qr-seam-overlap="0.1"',
    );
  });

  it("supports every upstream figure family, gradients, image, shape and update", async () => {
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
    expect(svg).toContain("<clipPath");
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

  it("fetches a remote logo once across Image and XHR paths", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response("<svg xmlns='http://www.w3.org/2000/svg' width='18' height='9'/>", {
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    const QRDOM = createWorkerJSDOM({ fetch: fetchMock });
    const qr = new QRCodeStyling({
      data: "remote-image",
      image: "https://assets.example/logo.svg",
      jsdom: QRDOM,
      type: "svg",
    });

    expect(await qr.getSvgString()).toContain("data:image/svg+xml;base64,");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces image failures instead of hanging", async () => {
    const QRDOM = createWorkerJSDOM({
      fetch: async () => new Response("missing", { status: 404 }),
    });
    const qr = new QRCodeStyling({
      data: "broken-image",
      image: "https://assets.example/missing.png",
      jsdom: QRDOM,
      type: "svg",
    });

    await expect(qr.getRawData("svg")).rejects.toThrow(/404/);
  });

  it("rejects raster output without a Cloudflare Images adapter", async () => {
    const qr = new QRCodeStyling({ data: "svg-only" });
    await expect(qr.getRawData("png")).rejects.toThrow(
      /createCloudflareCanvas/,
    );
  });

  it("exports runtime constants matching upstream option unions", () => {
    expect(Object.values(dotTypes)).toContain("classy-rounded");
    expect(Object.values(cornerSquareTypes)).toContain("extra-rounded");
    expect(Object.values(cornerDotTypes)).toContain("dot");
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

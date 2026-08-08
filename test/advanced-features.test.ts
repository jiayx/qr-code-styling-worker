import { Bitmap } from "qr";
import decodeQR from "qr/decode.js";
import { describe, expect, it, vi } from "vitest";
import QRCodeStyling, {
  encodeMatrix,
  renderSvgString,
} from "../src/index.js";

const logo =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='24'%3E%3Crect width='40' height='24' fill='red'/%3E%3C/svg%3E";

function decodeMatrix(matrix: ReturnType<typeof encodeMatrix>): string {
  const count = matrix.getModuleCount();
  const rows = Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, column) => matrix.isDark(row, column))
  );
  return decodeQR(new Bitmap(count, rows).border(4, false).scale(4).toImage());
}

describe("advanced renderer features", () => {
  it("renders standalone SVG strings without constructing the class DOM runtime", async () => {
    const svg = await renderSvgString({
      data: "pure-svg-string",
      dotsOptions: { roundSize: false, type: "rounded" },
      type: "canvas",
    });

    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('data-qr-contour-path="true"');
    expect(svg).not.toMatch(/\d+\.\d{7,}/);
    expect(await renderSvgString({
      data: "pure-svg-string",
      dotsOptions: { roundSize: false, type: "rounded" },
      type: "canvas",
    })).toBe(svg);
  });

  it("loads and embeds logos in the DOM-free SVG string renderer", async () => {
    const svg = await renderSvgString({
      data: "pure-svg-logo",
      image: logo,
      imageOptions: { backgroundColor: "#fff", margin: 4, shape: "rounded" },
    });

    expect(svg).toContain("<image");
    expect(svg).toContain('data-qr-logo-background="true"');
    expect(svg).toContain("<clipPath");
  });

  it("automatically mixes numeric, alphanumeric and byte segments", () => {
    const payload = "prefix-123456789012345678901234567890-ABCDEF";
    const automatic = encodeMatrix(payload, {
      errorCorrectionLevel: "M",
      typeNumber: 0,
    });
    const forcedByte = encodeMatrix(payload, {
      errorCorrectionLevel: "M",
      mode: "Byte",
      typeNumber: 0,
    });

    expect(automatic.segments.map((segment) => segment.mode)).toContain("Numeric");
    expect(automatic.segments.map((segment) => segment.mode)).toContain("Byte");
    expect(automatic.version).toBeLessThanOrEqual(forcedByte.version);
    expect(decodeMatrix(automatic)).toBe(payload);
  });

  it("exposes stable encoder and layout metadata with safety diagnostics", () => {
    const qr = new QRCodeStyling({
      data: "metadata",
      width: 320,
      height: 320,
      margin: 48,
      dotsOptions: { roundSize: false },
      type: "svg",
    });
    const diagnostics = qr.getDiagnostics();

    expect(diagnostics.metadata.version).toBeGreaterThan(0);
    expect(diagnostics.metadata.mask).toBeGreaterThanOrEqual(0);
    expect(diagnostics.metadata.mask).toBeLessThanOrEqual(7);
    expect(diagnostics.metadata.moduleCount).toBe(17 + 4 * diagnostics.metadata.version);
    expect(diagnostics.metadata.segments.length).toBeGreaterThan(0);
    expect(diagnostics.issues).not.toContainEqual(expect.objectContaining({ code: "quiet-zone" }));
  });

  it("can reject unsafe output in strict mode", () => {
    expect(() => new QRCodeStyling({
      backgroundOptions: { color: "#fff" },
      data: "unsafe",
      dotsOptions: { color: "#eee" },
      margin: 0,
      safetyOptions: { mode: "strict" },
      type: "svg",
    })).toThrow(/Unsafe QR configuration/);
  });

  it("renders declarative frames and styled logos", async () => {
    const qr = new QRCodeStyling({
      data: "framed-logo",
      accessibilityOptions: {
        description: "Opens the framed example",
        title: "Example QR code",
      },
      frameOptions: {
        color: "#2563eb",
        radius: 20,
        text: "Scan & open",
        type: "rounded",
        width: 4,
      },
      image: logo,
      imageOptions: {
        backgroundColor: "#fff",
        margin: 5,
        opacity: 0.8,
        shape: "circle",
      },
      margin: 32,
      type: "svg",
    });
    const svg = await qr.getSvgString();

    expect(svg).toContain('data-qr-frame="true"');
    expect(svg).toContain('data-qr-frame-text="true"');
    expect(svg).toContain("Scan &amp; open");
    expect(svg).toContain('data-qr-logo-background="true"');
    expect(svg).toContain('opacity="0.8"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title");
    expect(svg).toContain("<desc");
  });

  it("offers awaitable rendering callbacks and cancellation", async () => {
    const onComplete = vi.fn();
    const qr = await QRCodeStyling.render({ data: "async-render", type: "svg" }, {
      onComplete,
    });
    expect(qr.getMetadata().version).toBeGreaterThan(0);
    expect(onComplete).toHaveBeenCalledOnce();

    const controller = new AbortController();
    controller.abort();
    const onError = vi.fn();
    await expect(QRCodeStyling.render({ data: "cancelled", type: "svg" }, {
      onError,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(onError).toHaveBeenCalledOnce();
  });
});

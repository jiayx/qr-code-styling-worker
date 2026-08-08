import { describe, expect, it, vi } from "vitest";
import QRCodeStyling, {
  createCloudflareCanvas,
  type CloudflareImagesBinding,
} from "../src/index.js";

const outputs: string[] = [];
const images: CloudflareImagesBinding = {
  input: vi.fn(() => ({
    async output({
      format,
    }: {
      format: "image/jpeg" | "image/png" | "image/webp";
      quality?: number;
    }) {
      outputs.push(format);
      return {
        response: () =>
          new Response(new TextEncoder().encode(`encoded:${format}`), {
            headers: { "content-type": format },
          }),
      };
    },
  })),
};

describe("Cloudflare Images canvas adapter", () => {
  it.each([
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
  ] as const)("exports %s through an Images binding", async (extension, mimeType) => {
    outputs.length = 0;
    const qr = new QRCodeStyling({
      data: `raster-${extension}`,
      type: "canvas",
      canvasAdapter: createCloudflareCanvas(images),
    });

    const blob = await qr.getRawData(extension);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe(mimeType);
    expect(await blob?.text()).toBe(`encoded:${mimeType}`);
    expect(outputs).toEqual([mimeType]);
  });

  it("propagates transformation errors", async () => {
    const failingImages: CloudflareImagesBinding = {
      input: () => ({
        async output() {
          throw new Error("Images quota exceeded");
        },
      }),
    };
    const qr = new QRCodeStyling({
      data: "failure",
      type: "canvas",
      canvasAdapter: createCloudflareCanvas(failingImages),
    });

    await expect(qr.getRawData("png")).rejects.toThrow(/quota exceeded/);
  });
});

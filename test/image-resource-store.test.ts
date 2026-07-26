import { describe, expect, it } from "vitest";
import { ImageResourceStore } from "../src/index.js";

describe("ImageResourceStore", () => {
  it("enforces a streaming byte limit", async () => {
    const store = new ImageResourceStore({
      maxImageBytes: 4,
      fetch: async () =>
        new Response(new Uint8Array([1, 2, 3, 4, 5]), {
          headers: { "content-type": "image/png" },
        }),
    });

    await expect(store.load("https://example.com/large.png")).rejects.toThrow(
      /exceeds/,
    );
  });

  it("reads lossless WebP dimensions", async () => {
    const bytes = new Uint8Array(25);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    bytes.set(new TextEncoder().encode("WEBP"), 8);
    bytes.set(new TextEncoder().encode("VP8L"), 12);
    bytes[20] = 0x2f;
    const widthMinusOne = 19;
    const heightMinusOne = 11;
    const bits = widthMinusOne | (heightMinusOne << 14);
    bytes[21] = bits & 0xff;
    bytes[22] = (bits >>> 8) & 0xff;
    bytes[23] = (bits >>> 16) & 0xff;
    bytes[24] = (bits >>> 24) & 0xff;

    const store = new ImageResourceStore({
      fetch: async () =>
        new Response(bytes, { headers: { "content-type": "image/webp" } }),
    });
    const image = await store.load("https://example.com/logo.webp");

    expect(image.width).toBe(20);
    expect(image.height).toBe(12);
  });
});

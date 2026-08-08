import { Bitmap } from "qr";
import decodeQR from "qr/decode.js";
import { describe, expect, it } from "vitest";
import { encodeMatrix, type EncodeOptions } from "../src/encoder.js";

const defaultOptions: EncodeOptions = {
  errorCorrectionLevel: "M",
  typeNumber: 0,
};

function toBitmap(data: string, options: Partial<EncodeOptions> = {}): Bitmap {
  const matrix = encodeMatrix(data, { ...defaultOptions, ...options });
  const size = matrix.getModuleCount();
  const rows = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => matrix.isDark(row, column))
  );
  return new Bitmap(size, rows);
}

describe("QR matrix encoder", () => {
  it("produces a standards-decodable Unicode matrix", () => {
    const payload = "https://tools.tf/兼容测试";
    const bitmap = toBitmap(payload, { errorCorrectionLevel: "H" });

    expect(decodeQR(bitmap.border(4, false).scale(4).toImage())).toBe(payload);
  });

  it("supports explicit masks and automatic selection", () => {
    const payload = "https://tools.tf/mask";
    const mask0 = toBitmap(payload, { mask: 0 });
    const mask1 = toBitmap(payload, { mask: 1 });
    const automatic = toBitmap(payload);

    expect(mask0.toString()).not.toBe(mask1.toString());
    expect(automatic.width).toBe(mask0.width);
    expect(decodeQR(mask0.border(4, false).scale(4).toImage())).toBe(payload);
    expect(decodeQR(mask1.border(4, false).scale(4).toImage())).toBe(payload);
  });
});

import { type Bitmap, type ErrorCorrection, utils, utf8ToBytes } from "qr";
import type {
  ErrorCorrectionLevel,
  Mask,
  Mode,
  TypeNumber,
} from "./types.js";

const errorCorrectionMap = {
  L: "low",
  M: "medium",
  Q: "quartile",
  H: "high",
} as const;

const alphanumericAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

export type QrSegmentMode = "Numeric" | "Alphanumeric" | "Byte";

export interface QrSegment {
  mode: QrSegmentMode;
  text: string;
}

export interface EncodeOptions {
  errorCorrectionLevel: ErrorCorrectionLevel;
  mask?: Mask;
  mode?: Mode;
  typeNumber: TypeNumber;
}

export interface QrMatrix {
  readonly darkModuleCount: number;
  readonly mask: Mask;
  readonly segments: readonly QrSegment[];
  readonly version: number;
  getModuleCount(): number;
  isDark(row: number, column: number): boolean;
}

function internalMode(mode: QrSegmentMode): "numeric" | "alphanumeric" | "byte" {
  return mode === "Numeric" ? "numeric" : mode === "Alphanumeric" ? "alphanumeric" : "byte";
}

function optimizeSegments(data: string, version: number): QrSegment[] {
  const characters = Array.from(data);
  const modes: QrSegmentMode[] = Array.from({ length: characters.length }, () => "Byte");

  // A mode switch adds a mode indicator and a length field. Short runs cost
  // more than they save, so promote only runs that clearly amortize that header.
  for (let start = 0; start < characters.length;) {
    let end = start;
    while (/^\d$/.test(characters[end] ?? "")) end += 1;
    if (end - start >= 7) modes.fill("Numeric", start, end);
    start = end === start ? start + 1 : end;
  }
  for (let start = 0; start < characters.length;) {
    if (modes[start] !== "Byte" || !alphanumericAlphabet.includes(characters[start] ?? "")) {
      start += 1;
      continue;
    }
    let end = start;
    while (
      modes[end] === "Byte" &&
      alphanumericAlphabet.includes(characters[end] ?? "")
    ) end += 1;
    if (end - start >= 8) modes.fill("Alphanumeric", start, end);
    start = end;
  }

  const segments: QrSegment[] = [];
  for (let start = 0; start < characters.length;) {
    const mode = modes[start] ?? "Byte";
    let end = start + 1;
    while (modes[end] === mode) end += 1;
    const maxLength = 2 ** utils.info.lengthBits(version, internalMode(mode)) - 1;
    let chunkStart = start;
    while (chunkStart < end) {
      let chunkEnd = chunkStart;
      let encodedLength = 0;
      while (chunkEnd < end) {
        const increment = mode === "Byte"
          ? utf8ToBytes(characters[chunkEnd] ?? "").length
          : 1;
        if (encodedLength + increment > maxLength) break;
        encodedLength += increment;
        chunkEnd += 1;
      }
      if (chunkEnd === chunkStart) throw new Error("Unable to split QR segment");
      segments.push({ mode, text: characters.slice(chunkStart, chunkEnd).join("") });
      chunkStart = chunkEnd;
    }
    start = end;
  }
  const byteSegments: QrSegment[] = [];
  const byteLimit = 2 ** utils.info.lengthBits(version, "byte") - 1;
  for (let start = 0; start < characters.length;) {
    let end = start;
    let length = 0;
    while (end < characters.length) {
      const increment = utf8ToBytes(characters[end] ?? "").length;
      if (length + increment > byteLimit) break;
      length += increment;
      end += 1;
    }
    if (end === start) throw new Error("Unable to split QR byte segment");
    byteSegments.push({ mode: "Byte", text: characters.slice(start, end).join("") });
    start = end;
  }
  const bitLength = (items: QrSegment[]) =>
    items.reduce((total, segment) => total + encodeSegment(segment, version).length, 0);
  return bitLength(segments) < bitLength(byteSegments) ? segments : byteSegments;
}

function explicitSegments(data: string, mode: Mode | undefined): QrSegment[] | undefined {
  if (!mode) return undefined;
  return [{ mode: mode === "Kanji" ? "Byte" : mode, text: data }];
}

function encodeSegment(segment: QrSegment, version: number): string {
  const mode = internalMode(segment.mode);
  let values: number[];
  let length: number;
  let encoded = "";
  if (segment.mode === "Numeric") {
    if (!/^\d+$/.test(segment.text)) {
      throw new Error("Numeric mode accepts digits only");
    }
    values = Array.from(segment.text, Number);
    length = values.length;
    for (let index = 0; index < values.length; index += 3) {
      const remaining = Math.min(3, values.length - index);
      const value = values.slice(index, index + remaining)
        .reduce((total, digit) => total * 10 + digit, 0);
      encoded += utils.bin(value, remaining === 3 ? 10 : remaining === 2 ? 7 : 4);
    }
  } else if (segment.mode === "Alphanumeric") {
    values = Array.from(segment.text, (character) => alphanumericAlphabet.indexOf(character));
    if (values.some((value) => value < 0)) {
      throw new Error("Alphanumeric mode contains an unsupported character");
    }
    length = values.length;
    for (let index = 0; index < values.length; index += 2) {
      encoded += index + 1 < values.length
        ? utils.bin((values[index] ?? 0) * 45 + (values[index + 1] ?? 0), 11)
        : utils.bin(values[index] ?? 0, 6);
    }
  } else {
    const bytes = utf8ToBytes(segment.text);
    length = bytes.length;
    encoded = Array.from(bytes, (value) => utils.bin(value, 8)).join("");
  }
  const lengthBits = utils.info.lengthBits(version, mode);
  if (length >= 2 ** lengthBits) throw new Error("Segment length overflow");
  return `${utils.info.modeBits[mode]}${utils.bin(length, lengthBits)}${encoded}`;
}

function encodeCodewords(
  segments: QrSegment[],
  version: number,
  ecc: ErrorCorrection,
): Uint8Array {
  const capacity = utils.info.capacity(version, ecc).capacity;
  let bits = segments.map((segment) => encodeSegment(segment, version)).join("");
  if (bits.length > capacity) throw new Error("Capacity overflow");
  bits += "0".repeat(Math.min(4, capacity - bits.length));
  if (bits.length % 8) bits += "0".repeat(8 - bits.length % 8);
  const padding = "1110110000010001";
  for (let index = 0; bits.length < capacity; index += 1) {
    bits += padding[index % padding.length];
  }
  const bytes = Uint8Array.from(bits.match(/.{8}/g) ?? [], (value) => Number(`0b${value}`));
  return utils.interleave(version, ecc).encode(bytes);
}

function selectMask(
  version: number,
  ecc: ErrorCorrection,
  codewords: Uint8Array,
  requested: Mask | undefined,
): Mask {
  if (requested !== undefined) return requested;
  let selected: Mask = 0;
  let score = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = penalty(drawQr(version, ecc, codewords, mask as Mask, true));
    if (candidate < score) {
      selected = mask as Mask;
      score = candidate;
    }
  }
  return selected;
}

function drawQr(
  version: number,
  ecc: ErrorCorrection,
  data: Uint8Array,
  mask: Mask,
  test = false,
): Bitmap {
  const bitmap = utils.drawTemplate(version, ecc, mask, test);
  let bitIndex = 0;
  const bitLength = data.length * 8;
  utils.zigzag(bitmap, mask, (x, y, masked) => {
    const value = bitIndex < bitLength
      ? (((data[bitIndex >>> 3] ?? 0) >> ((7 - bitIndex) & 7)) & 1) === 1
      : false;
    if (bitIndex < bitLength) bitIndex += 1;
    bitmap.set(x, y, value !== masked);
  });
  if (bitIndex !== bitLength) throw new Error("QR data did not fit the matrix");
  return bitmap;
}

const finderPattern = Number("0b10111010000");
const reverseFinderPattern = Number("0b00001011101");

function penalty(bitmap: Bitmap): number {
  const transposed = bitmap.transpose();
  let adjacent = 0;
  for (let row = 0; row < bitmap.height; row += 1) {
    bitmap.getRuns(row, (length) => {
      if (length >= 5) adjacent += 3 + length - 5;
    });
  }
  for (let row = 0; row < transposed.height; row += 1) {
    transposed.getRuns(row, (length) => {
      if (length >= 5) adjacent += 3 + length - 5;
    });
  }
  let boxes = 0;
  for (let row = 0; row < bitmap.height - 1; row += 1) {
    boxes += 3 * bitmap.countBoxes2x2(row);
  }
  let finders = 0;
  for (let row = 0; row < bitmap.height; row += 1) {
    finders += 40 * bitmap.countPatternInRow(
      row,
      11,
      finderPattern,
      reverseFinderPattern,
    );
  }
  for (let row = 0; row < transposed.height; row += 1) {
    finders += 40 * transposed.countPatternInRow(
      row,
      11,
      finderPattern,
      reverseFinderPattern,
    );
  }
  const total = bitmap.width * bitmap.height;
  const deviation = Math.max(
    0,
    Math.abs(bitmap.popcnt() * 100 - total * 50) - total * 5,
  );
  return adjacent + boxes + finders + 10 * Math.ceil(deviation / (total * 5));
}

function createMatrix(
  bitmap: Bitmap,
  version: number,
  mask: Mask,
  segments: QrSegment[],
): QrMatrix {
  bitmap.assertDrawn();
  return {
    darkModuleCount: bitmap.popcnt(),
    mask,
    segments,
    version,
    getModuleCount: () => bitmap.width,
    isDark: (row, column) => bitmap.get(column, row),
  };
}

export function encodeMatrix(data: string, options: EncodeOptions): QrMatrix {
  if (
    options.mask !== undefined &&
    (!Number.isInteger(options.mask) || options.mask < 0 || options.mask > 7)
  ) {
    throw new RangeError("Invalid mask; expected an integer from 0 through 7");
  }
  const ecc = errorCorrectionMap[options.errorCorrectionLevel];
  const fixedSegments = explicitSegments(data, options.mode);
  let lastError = new Error("QR payload does not fit version 40");
  const firstVersion = options.typeNumber === 0 ? 1 : options.typeNumber;
  const lastVersion = options.typeNumber === 0 ? 40 : options.typeNumber;
  let cachedGroup = -1;
  let segments: QrSegment[] = [];

  for (let version = firstVersion; version <= lastVersion; version += 1) {
    const group = version < 10 ? 0 : version < 27 ? 1 : 2;
    if (fixedSegments) {
      segments = fixedSegments;
    } else if (group !== cachedGroup) {
      segments = optimizeSegments(data, version);
      cachedGroup = group;
    }
    try {
      const codewords = encodeCodewords(segments, version, ecc);
      const mask = selectMask(version, ecc, codewords, options.mask);
      return createMatrix(drawQr(version, ecc, codewords, mask), version, mask, segments);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError;
}

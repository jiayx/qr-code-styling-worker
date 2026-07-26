const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const BASE64_CHUNK_SIZE = 32_768;

export interface ImageResource {
  bytes: Uint8Array;
  dataUrl: string;
  height: number;
  mimeType: string;
  width: number;
}

export interface ImageResourceStoreOptions {
  fetch?: typeof fetch;
  maxImageBytes?: number;
  timeoutMs?: number;
}

export class ImageLoadError extends Error {
  override readonly name = "ImageLoadError";
}

function byte(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (byte(bytes, offset) << 8) | byte(bytes, offset + 1);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return byte(bytes, offset) | (byte(bytes, offset + 1) << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (
    byte(bytes, offset) |
    (byte(bytes, offset + 1) << 8) |
    (byte(bytes, offset + 2) << 16)
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((byte(bytes, offset) << 24) |
      (byte(bytes, offset + 1) << 16) |
      (byte(bytes, offset + 2) << 8) |
      byte(bytes, offset + 3)) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (byte(bytes, offset) |
      (byte(bytes, offset + 1) << 8) |
      (byte(bytes, offset + 2) << 16) |
      (byte(bytes, offset + 3) << 24)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function parseSvgSize(bytes: Uint8Array): { height: number; width: number } | null {
  const source = new TextDecoder().decode(bytes);
  const svgTag = /<svg\b[^>]*>/i.exec(source)?.[0];
  if (!svgTag) return null;

  const width = /\bwidth=["']\s*([+-]?(?:\d+\.?\d*|\.\d+))(?:px)?\s*["']/i.exec(svgTag);
  const height = /\bheight=["']\s*([+-]?(?:\d+\.?\d*|\.\d+))(?:px)?\s*["']/i.exec(svgTag);
  if (width && height) {
    return {
      width: Number(width[1]),
      height: Number(height[1]),
    };
  }

  const viewBox = /\bviewBox=["']\s*([+-]?(?:\d+\.?\d*|\.\d+))[\s,]+([+-]?(?:\d+\.?\d*|\.\d+))[\s,]+([+-]?(?:\d+\.?\d*|\.\d+))[\s,]+([+-]?(?:\d+\.?\d*|\.\d+))\s*["']/i.exec(
    svgTag,
  );
  if (!viewBox) return null;

  return {
    width: Number(viewBox[3]),
    height: Number(viewBox[4]),
  };
}

function parsePngSize(bytes: Uint8Array): { height: number; width: number } | null {
  if (
    bytes.length < 24 ||
    byte(bytes, 0) !== 0x89 ||
    ascii(bytes, 1, 4) !== "PNG" ||
    byte(bytes, 4) !== 0x0d ||
    byte(bytes, 5) !== 0x0a ||
    byte(bytes, 6) !== 0x1a ||
    byte(bytes, 7) !== 0x0a
  ) {
    return null;
  }

  return {
    width: readUint32BE(bytes, 16),
    height: readUint32BE(bytes, 20),
  };
}

function parseGifSize(bytes: Uint8Array): { height: number; width: number } | null {
  if (bytes.length < 10) return null;
  const header = ascii(bytes, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return null;

  return {
    width: readUint16LE(bytes, 6),
    height: readUint16LE(bytes, 8),
  };
}

function parseJpegSize(bytes: Uint8Array): { height: number; width: number } | null {
  if (bytes.length < 4 || byte(bytes, 0) !== 0xff || byte(bytes, 1) !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (byte(bytes, offset) !== 0xff) {
      offset += 1;
      continue;
    }

    let marker = byte(bytes, offset + 1);
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = byte(bytes, offset + 1);
    }

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      offset += 2;
      continue;
    }

    const blockLength = readUint16BE(bytes, offset + 2);
    if (blockLength < 2 || offset + 2 + blockLength > bytes.length) break;

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isStartOfFrame && blockLength >= 7) {
      return {
        height: readUint16BE(bytes, offset + 5),
        width: readUint16BE(bytes, offset + 7),
      };
    }

    offset += 2 + blockLength;
  }

  return null;
}

function parseWebpSize(bytes: Uint8Array): { height: number; width: number } | null {
  if (
    bytes.length < 25 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 12) !== "WEBP"
  ) {
    return null;
  }

  const chunk = ascii(bytes, 12, 16);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: readUint24LE(bytes, 24) + 1,
      height: readUint24LE(bytes, 27) + 1,
    };
  }

  if (
    chunk === "VP8 " &&
    bytes.length >= 30 &&
    byte(bytes, 23) === 0x9d &&
    byte(bytes, 24) === 0x01 &&
    byte(bytes, 25) === 0x2a
  ) {
    return {
      width: readUint16LE(bytes, 26) & 0x3fff,
      height: readUint16LE(bytes, 28) & 0x3fff,
    };
  }

  if (chunk === "VP8L" && byte(bytes, 20) === 0x2f) {
    const bits = readUint32LE(bytes, 21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

function sniffMimeType(bytes: Uint8Array): string | null {
  if (parsePngSize(bytes)) return "image/png";
  if (parseGifSize(bytes)) return "image/gif";
  if (parseJpegSize(bytes)) return "image/jpeg";
  if (parseWebpSize(bytes)) return "image/webp";

  const prefix = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  if (prefix.startsWith("<svg") || prefix.startsWith("<?xml")) {
    return "image/svg+xml";
  }

  return null;
}

function inferSize(
  mimeType: string,
  bytes: Uint8Array,
): { height: number; width: number } {
  const parsed =
    (mimeType === "image/svg+xml" ? parseSvgSize(bytes) : null) ??
    parsePngSize(bytes) ??
    parseGifSize(bytes) ??
    parseJpegSize(bytes) ??
    parseWebpSize(bytes);

  return parsed ?? { width: 256, height: 256 };
}

function normalizeMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
}

function isSupportedImageMimeType(mimeType: string): boolean {
  return [
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
    "image/webp",
  ].includes(mimeType);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replaceAll(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.slice(offset, offset + BASE64_CHUNK_SIZE)));
  }
  return btoa(chunks.join(""));
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function parseDataUrl(
  dataUrl: string,
  maxImageBytes: number,
): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;,]+)?((?:;[^,]+)*?),(.*)$/s.exec(dataUrl);
  if (!match) throw new ImageLoadError("Invalid image data URL");

  const mimeType = normalizeMimeType(match[1] || "text/plain");
  const metadata = match[2] || "";
  const payload = match[3] || "";

  if (!isSupportedImageMimeType(mimeType)) {
    throw new ImageLoadError(`Unsupported image MIME type: ${mimeType}`);
  }

  const estimatedBytes = metadata.includes(";base64")
    ? Math.ceil((payload.length * 3) / 4)
    : payload.length;
  if (estimatedBytes > maxImageBytes) {
    throw new ImageLoadError(`Image exceeds the ${maxImageBytes} byte limit`);
  }

  const bytes = metadata.includes(";base64")
    ? decodeBase64(payload)
    : new TextEncoder().encode(decodeURIComponent(payload));

  if (bytes.byteLength > maxImageBytes) {
    throw new ImageLoadError(`Image exceeds the ${maxImageBytes} byte limit`);
  }

  return { bytes, mimeType };
}

async function readBoundedBody(
  response: Response,
  maxImageBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    throw new ImageLoadError("Image response has no body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      size += value.byteLength;
      if (size > maxImageBytes) {
        await reader.cancel();
        throw new ImageLoadError(`Image exceeds the ${maxImageBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class ImageResourceStore {
  readonly #cache = new Map<string, Promise<ImageResource>>();
  readonly #fetch: typeof fetch;
  readonly #maxImageBytes: number;
  readonly #timeoutMs: number;

  constructor(options: ImageResourceStoreOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  load(source: string): Promise<ImageResource> {
    const cached = this.#cache.get(source);
    if (cached) return cached;

    const pending = this.#loadUncached(source);
    this.#cache.set(source, pending);
    void pending.catch(() => {
      this.#cache.delete(source);
    });
    return pending;
  }

  async #loadUncached(source: string): Promise<ImageResource> {
    let bytes: Uint8Array;
    let mimeType: string;

    if (source.startsWith("data:")) {
      ({ bytes, mimeType } = parseDataUrl(source, this.#maxImageBytes));
    } else {
      let url: URL;
      try {
        url = new URL(source);
      } catch {
        throw new ImageLoadError("Image source must be an absolute HTTP(S) URL or data URL");
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new ImageLoadError(`Unsupported image URL protocol: ${url.protocol}`);
      }

      const response = await this.#fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) {
        throw new ImageLoadError(`Failed to fetch image: HTTP ${response.status}`);
      }

      const contentLength = Number(response.headers.get("content-length") || "0");
      if (Number.isFinite(contentLength) && contentLength > this.#maxImageBytes) {
        throw new ImageLoadError(`Image exceeds the ${this.#maxImageBytes} byte limit`);
      }

      bytes = await readBoundedBody(response, this.#maxImageBytes);
      mimeType = normalizeMimeType(
        response.headers.get("content-type") || sniffMimeType(bytes) || "",
      );
      if (!isSupportedImageMimeType(mimeType)) {
        throw new ImageLoadError(`Unsupported image MIME type: ${mimeType}`);
      }
    }

    const { width, height } = inferSize(mimeType, bytes);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new ImageLoadError("Image dimensions are invalid");
    }

    return {
      bytes,
      dataUrl: bytesToDataUrl(bytes, mimeType),
      height,
      mimeType,
      width,
    };
  }
}

import {
  ImageResourceStore,
  type ImageResource,
  type ImageResourceStoreOptions,
} from "./image-resource-store.js";

const canvasStateKey = Symbol("qr-code-styling-worker.canvas-state");

type RasterMimeType = "image/jpeg" | "image/png" | "image/webp";

interface CanvasState {
  errors: Error[];
  images: CloudflareImagesBinding;
  store: ImageResourceStore;
}

export interface CloudflareImageTransformer {
  output(options: {
    format: RasterMimeType;
    quality?: number;
  }): Promise<CloudflareImageTransformationResult>;
}

export interface CloudflareImageTransformationResult {
  response(): Response;
}

export interface CloudflareImagesBinding {
  input(stream: ReadableStream<Uint8Array>): CloudflareImageTransformer;
}

export interface WorkerCanvasImage {
  readonly height: number;
  readonly resource: ImageResource;
  readonly width: number;
}

export interface WorkerCanvasRenderingContext2D {
  drawImage(image: WorkerCanvasImage, x: number, y: number): void;
}

export interface WorkerCanvas {
  height: number;
  width: number;
  getContext(type: "2d"): WorkerCanvasRenderingContext2D;
  toBlob(
    callback: (blob: Blob | null) => void,
    mimeType?: string,
    quality?: number,
  ): void;
  toDataURL(mimeType?: string): string;
}

export interface WorkerCanvasModule {
  createCanvas(width: number, height: number): WorkerCanvas;
  loadImage(source: string): Promise<WorkerCanvasImage>;
}

type InternalWorkerCanvasModule = WorkerCanvasModule & {
  readonly [canvasStateKey]: CanvasState;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isRasterMimeType(value: string): value is RasterMimeType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function normalizeQuality(quality: number | undefined): number | undefined {
  if (quality === undefined) return undefined;
  if (!Number.isFinite(quality)) return undefined;
  const percent = quality <= 1 ? quality * 100 : quality;
  return Math.min(100, Math.max(1, Math.round(percent)));
}

class CloudflareWorkerCanvas implements WorkerCanvas {
  height: number;
  width: number;

  readonly #state: CanvasState;
  #image: WorkerCanvasImage | null = null;

  constructor(width: number, height: number, state: CanvasState) {
    this.width = width;
    this.height = height;
    this.#state = state;
  }

  getContext(type: "2d"): WorkerCanvasRenderingContext2D {
    if (type !== "2d") {
      throw new TypeError(`Unsupported canvas context: ${String(type)}`);
    }

    return {
      drawImage: (image: WorkerCanvasImage) => {
        this.#image = image;
      },
    };
  }

  toDataURL(): string {
    if (!this.#image) {
      throw new Error("Canvas has not been drawn");
    }
    return this.#image.resource.dataUrl;
  }

  toBlob(
    callback: (blob: Blob | null) => void,
    mimeType = "image/png",
    quality?: number,
  ): void {
    if (!this.#image) {
      const error = new Error("Canvas has not been drawn");
      this.#state.errors.push(error);
      callback(null);
      return;
    }

    if (!isRasterMimeType(mimeType)) {
      const error = new Error(`Unsupported raster output MIME type: ${mimeType}`);
      this.#state.errors.push(error);
      callback(null);
      return;
    }

    const image = this.#image;
    const outputOptions = {
      format: mimeType,
      quality: normalizeQuality(quality),
    };

    void this.#state.images
      .input(
        new Blob([image.resource.bytes.slice().buffer], {
          type: image.resource.mimeType,
        }).stream(),
      )
      .output(outputOptions)
      .then((result) => result.response().blob())
      .then(callback)
      .catch((error: unknown) => {
        this.#state.errors.push(toError(error));
        callback(null);
      });
  }
}

export type CloudflareCanvasOptions = ImageResourceStoreOptions;

export function createCloudflareCanvas(
  images: CloudflareImagesBinding,
  options: CloudflareCanvasOptions = {},
): WorkerCanvasModule {
  const state: CanvasState = {
    errors: [],
    images,
    store: new ImageResourceStore(options),
  };

  const module: InternalWorkerCanvasModule = {
    [canvasStateKey]: state,
    createCanvas(width, height) {
      return new CloudflareWorkerCanvas(width, height, state);
    },
    async loadImage(source) {
      const resource = await state.store.load(source);
      return {
        width: resource.width,
        height: resource.height,
        resource,
      };
    },
  };

  return module;
}

export function throwWorkerCanvasErrors(module: WorkerCanvasModule | undefined): void {
  if (!module || !(canvasStateKey in module)) return;

  const state = (module as InternalWorkerCanvasModule)[canvasStateKey];
  const first = state.errors[0];
  if (!first) return;
  throw new Error(`QR rasterization failed: ${first.message}`, { cause: first });
}

export function clearWorkerCanvasErrors(module: WorkerCanvasModule | undefined): void {
  if (!module || !(canvasStateKey in module)) return;
  (module as InternalWorkerCanvasModule)[canvasStateKey].errors.length = 0;
}

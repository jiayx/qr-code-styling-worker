import {
  clearWorkerCanvasErrors,
  throwWorkerCanvasErrors,
  type WorkerCanvas,
  type WorkerCanvasModule,
} from "./cloudflare-canvas.js";
import { encodeMatrix, type QrMatrix } from "./encoder.js";
import { diagnoseQr, getQrMetadata, throwUnsafeQr } from "./diagnostics.js";
import { ImageResourceStore } from "./image-resource-store.js";
import { mergeOptions, type ResolvedOptions } from "./options.js";
import {
  createSvgRoot,
  renderSvg,
} from "./svg-renderer.js";
import {
  normalizeSeamOverlap,
  type SvgRenderingOptions,
} from "./svg-rendering.js";
import {
  createStringSvgRuntime,
  type SvgStringOptions,
} from "./svg-string-renderer.js";
import type {
  DownloadOptions,
  ExtensionFunction,
  FileExtension,
  Options,
} from "./types.js";
import type { QrDiagnostics } from "./diagnostics.js";

export * from "./cloudflare-canvas.js";
export * from "./compatibility.js";
export * from "./constants.js";
export * from "./diagnostics.js";
export * from "./encoder.js";
export * from "./image-resource-store.js";
export * from "./shapes.js";
export * from "./svg-rendering.js";
export {
  renderSvgString,
  type SvgStringOptions,
  type SvgStringRenderOptions,
} from "./svg-string-renderer.js";
export * from "./types.js";

export interface WorkerOptions extends Omit<Options, "jsdom"> {
  /** @deprecated Accepted for source compatibility and intentionally ignored. */
  jsdom?: Options["jsdom"];
  canvasAdapter?: WorkerCanvasModule;
  resourceOptions?: SvgStringOptions;
  svgOptions?: SvgRenderingOptions;
}

export interface RenderControls {
  onComplete?: (diagnostics: QrDiagnostics) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

interface RenderingRuntime {
  document: Document;
  Image: new () => HTMLImageElement;
  XMLSerializer: new () => XMLSerializer;
  URL?: typeof URL;
}

interface CanvasLike {
  height: number;
  width: number;
  getContext(type: "2d"): {
    drawImage(image: unknown, x: number, y: number, width?: number, height?: number): void;
  } | null;
  toBlob(
    callback: (blob: Blob | null) => void,
    mimeType?: string,
    quality?: number,
  ): void;
  toDataURL(mimeType?: string): string;
}

function isServerRuntime(): boolean {
  return typeof window === "undefined" || typeof document === "undefined";
}

function createRenderingRuntime(
  serverRuntime: boolean,
  imageStore: ImageResourceStore,
  baseUrl?: string,
): RenderingRuntime {
  if (!serverRuntime) return window as unknown as RenderingRuntime;
  return createStringSvgRuntime(imageStore, baseUrl) as RenderingRuntime;
}

function stripRendererOptions(options?: Partial<WorkerOptions>): Partial<Options> {
  if (!options) return {};
  const compatibleOptions = { ...options };
  delete compatibleOptions.canvasAdapter;
  delete compatibleOptions.jsdom;
  delete compatibleOptions.resourceOptions;
  delete compatibleOptions.svgOptions;
  return compatibleOptions as Partial<Options>;
}

function rejectNodeCanvasOption(options?: Partial<WorkerOptions>): void {
  if (options && "nodeCanvas" in options) {
    throw new TypeError(
      "nodeCanvas is not supported; use canvasAdapter with createCloudflareCanvas(env.IMAGES)",
    );
  }
}

function mimeType(extension: FileExtension): string {
  switch (extension.toLowerCase()) {
    case "svg":
      return "image/svg+xml";
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function svgDataUrl(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

function loadBrowserImage(
  runtime: RenderingRuntime,
  source: string,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new runtime.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to rasterize QR SVG"));
    image.src = source;
  });
}

function abortError(): Error {
  return new DOMException("QR rendering was aborted", "AbortError");
}

async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export default class QRCodeStyling {
  readonly #serverRuntime: boolean;
  readonly #runtime: RenderingRuntime;
  #options: ResolvedOptions;
  #container?: HTMLElement;
  #canvasElement?: HTMLCanvasElement;
  #workerCanvasElement?: WorkerCanvas;
  #svgElement?: SVGElement;
  #matrix?: QrMatrix;
  #extension?: ExtensionFunction;
  #rasterRenderPromise?: Promise<void>;
  #svgRenderPromise?: Promise<void>;
  #seamOverlap: number;
  #canvasAdapter?: WorkerCanvasModule;
  #imageStore: ImageResourceStore;

  constructor(options?: Partial<WorkerOptions>) {
    rejectNodeCanvasOption(options);
    this.#serverRuntime = isServerRuntime();
    const { baseUrl, ...resourceOptions } = options?.resourceOptions ?? {};
    this.#imageStore = new ImageResourceStore({
      ...resourceOptions,
      fetch: resourceOptions.fetch ?? (this.#serverRuntime
        ? undefined
        : window.fetch.bind(window)),
    });
    this.#runtime = createRenderingRuntime(
      this.#serverRuntime,
      this.#imageStore,
      baseUrl,
    );
    this.#canvasAdapter = options?.canvasAdapter;
    this.#seamOverlap = normalizeSeamOverlap(options?.svgOptions?.seamOverlap);
    this.#options = mergeOptions(
      undefined,
      stripRendererOptions(options),
      this.#serverRuntime && !options?.canvasAdapter,
    );
    this.#render();
  }

  static async render(
    options: Partial<WorkerOptions>,
    controls: RenderControls = {},
  ): Promise<QRCodeStyling> {
    let qr: QRCodeStyling;
    try {
      qr = new QRCodeStyling(options);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      controls.onError?.(normalized);
      throw normalized;
    }
    await qr.ready(controls);
    return qr;
  }

  static #clearContainer(container?: HTMLElement): void {
    if (container) container.innerHTML = "";
  }

  #renderCanvas(): void {
    if (!this.#matrix || !this.#svgElement || !this.#svgRenderPromise) return;
    this.#canvasElement = undefined;
    this.#workerCanvasElement = undefined;

    let canvas: CanvasLike;
    if (this.#canvasAdapter) {
      this.#workerCanvasElement = this.#canvasAdapter.createCanvas(
        this.#options.width,
        this.#options.height,
      );
      canvas = this.#workerCanvasElement as CanvasLike;
    } else if (!this.#serverRuntime) {
      this.#canvasElement = this.#runtime.document.createElement("canvas");
      this.#canvasElement.width = this.#options.width;
      this.#canvasElement.height = this.#options.height;
      canvas = this.#canvasElement as CanvasLike;
    } else {
      this.#rasterRenderPromise = Promise.reject(new Error(
        "Cannot export raster output without canvasAdapter: createCloudflareCanvas(env.IMAGES)",
      ));
      // Avoid an unhandled rejection when construction defaults to canvas in a
      // custom server DOM. getRawData() will surface the same error.
      void this.#rasterRenderPromise.catch(() => undefined);
      return;
    }

    this.#rasterRenderPromise = this.#svgRenderPromise.then(async () => {
      if (!this.#svgElement) return;
      const source = new this.#runtime.XMLSerializer().serializeToString(
        this.#svgElement,
      );
      const dataUrl = svgDataUrl(source);
      const image = this.#canvasAdapter
        ? await this.#canvasAdapter.loadImage(dataUrl)
        : await loadBrowserImage(this.#runtime, dataUrl);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Unable to create a 2D canvas context");
      context.drawImage(image, 0, 0, this.#options.width, this.#options.height);
    });
  }

  async #getOutputElement(
    extension: FileExtension = "png",
  ): Promise<HTMLCanvasElement | WorkerCanvas | SVGElement | undefined> {
    if (!this.#matrix) throw new Error("QR code is empty");
    if (extension.toLowerCase() === "svg") {
      if (!this.#svgRenderPromise) this.#renderSvg();
      await this.#svgRenderPromise;
      return this.#svgElement;
    }
    if (!this.#rasterRenderPromise) this.#renderCanvas();
    await this.#rasterRenderPromise;
    return this.#canvasElement ?? this.#workerCanvasElement;
  }

  update(options?: Partial<WorkerOptions>): void {
    rejectNodeCanvasOption(options);
    QRCodeStyling.#clearContainer(this.#container);
    clearWorkerCanvasErrors(this.#canvasAdapter);
    if (options?.svgOptions?.seamOverlap !== undefined) {
      this.#seamOverlap = normalizeSeamOverlap(options.svgOptions.seamOverlap);
    }
    if (options && Object.hasOwn(options, "canvasAdapter")) {
      this.#canvasAdapter = options.canvasAdapter;
    }
    this.#options = mergeOptions(
      this.#options,
      stripRendererOptions(options),
      this.#serverRuntime && !this.#canvasAdapter,
    );
    this.#render();
    this.append(this.#container);
  }

  async updateAsync(
    options?: Partial<WorkerOptions>,
    controls: RenderControls = {},
  ): Promise<void> {
    try {
      this.update(options);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      controls.onError?.(normalized);
      throw normalized;
    }
    await this.ready(controls);
  }

  async ready(controls: RenderControls = {}): Promise<void> {
    try {
      const promise = this.#options.type === "canvas"
        ? this.#rasterRenderPromise
        : this.#svgRenderPromise;
      if (promise) await waitWithSignal(promise, controls.signal);
      throwWorkerCanvasErrors(this.#canvasAdapter);
      controls.onComplete?.(this.getDiagnostics());
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      controls.onError?.(normalized);
      throw normalized;
    }
  }

  append(container?: HTMLElement): void {
    if (!container) return;
    if (typeof container.appendChild !== "function") {
      throw new TypeError("Container should be a single DOM node");
    }
    const element = this.#options.type === "canvas"
      ? this.#canvasElement
      : this.#svgElement;
    if (element) container.appendChild(element);
    this.#container = container;
  }

  applyExtension(extension: ExtensionFunction): void {
    if (!extension) throw new Error("Extension function must be defined");
    this.#extension = extension;
    this.update();
  }

  deleteExtension(): void {
    this.#extension = undefined;
    this.update();
  }

  async getRawData(extension: FileExtension = "png"): Promise<Blob | null> {
    const element = await this.#getOutputElement(extension);
    throwWorkerCanvasErrors(this.#canvasAdapter);
    if (!element) return null;

    if (extension.toLowerCase() === "svg") {
      const source = `<?xml version="1.0" standalone="no"?>\r\n${
        new this.#runtime.XMLSerializer().serializeToString(element as SVGElement)
      }`;
      return new Blob([source], { type: mimeType("svg") });
    }

    return new Promise<Blob | null>((resolve, reject) => {
      const canvas = element as CanvasLike;
      try {
        canvas.toBlob((blob) => {
          try {
            throwWorkerCanvasErrors(this.#canvasAdapter);
            resolve(blob);
          } catch (error) {
            reject(error);
          }
        }, mimeType(extension), 1);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getSvgString(): Promise<string> {
    const raw = await this.getRawData("svg");
    if (!raw) throw new Error("QR code is empty");
    return raw.text();
  }

  getMetadata() {
    if (!this.#matrix) throw new Error("QR code is empty");
    return getQrMetadata(this.#matrix, this.#options);
  }

  getDiagnostics() {
    if (!this.#matrix) throw new Error("QR code is empty");
    return diagnoseQr(this.#matrix, this.#options);
  }

  async download(
    downloadOptions?: Partial<DownloadOptions> | string,
  ): Promise<void> {
    if (this.#serverRuntime) {
      throw new Error(
        "Cannot download in a Worker runtime; call getRawData() and return the Blob in a Response",
      );
    }
    const extension = typeof downloadOptions === "string"
      ? downloadOptions as FileExtension
      : downloadOptions?.extension ?? "png";
    if (typeof downloadOptions === "string") {
      console.warn(
        "Extension is deprecated as argument for 'download' method, please pass object { name: '...', extension: '...' } as argument",
      );
    }
    const name = typeof downloadOptions === "object" && downloadOptions?.name
      ? downloadOptions.name
      : "qr";
    const blob = await this.getRawData(extension);
    if (!blob) return;
    const urlApi = this.#runtime.URL ?? URL;
    const url = urlApi.createObjectURL(blob);
    const anchor = this.#runtime.document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}.${extension}`;
    anchor.click();
    urlApi.revokeObjectURL(url);
  }

  #render(): void {
    this.#matrix = undefined;
    this.#svgElement = undefined;
    this.#canvasElement = undefined;
    this.#workerCanvasElement = undefined;
    this.#svgRenderPromise = undefined;
    this.#rasterRenderPromise = undefined;
    if (!this.#options.data) return;

    this.#matrix = encodeMatrix(this.#options.data, this.#options.qrOptions);
    throwUnsafeQr(diagnoseQr(this.#matrix, this.#options));
    this.#renderSvg();
    if (this.#options.type === "canvas") this.#renderCanvas();
  }

  #renderSvg(): void {
    if (!this.#matrix) return;
    const svg = createSvgRoot(this.#runtime, this.#options);
    this.#svgElement = svg;
    this.#svgRenderPromise = renderSvg(
      svg,
      this.#matrix,
      this.#options,
      this.#runtime,
      this.#options.dotsOptions.roundSize ? 0 : this.#seamOverlap,
      this.#imageStore,
    ).then(() => {
      this.#extension?.(svg, this.#options);
    });
  }
}

export type {
  BasicFigureDrawArgs,
  CornerDotType,
  CornerDotTypes,
  CornerSquareType,
  CornerSquareTypes,
  DotType,
  DotTypes,
  DownloadOptions,
  DrawArgs,
  DrawType,
  DrawTypes,
  ErrorCorrectionLevel,
  ExtensionFunction,
  FileExtension,
  FilterFunction,
  FinderCenterShape,
  FinderFrameShape,
  GetNeighbor,
  Gradient,
  GradientType,
  GradientTypes,
  Mask,
  Mode,
  ModuleShape,
  Options,
  QRCode,
  RotateFigureArgs,
  ShapeType,
  ShapeTypes,
  TypeNumber,
  UnknownObject,
  Window,
} from "./types.js";

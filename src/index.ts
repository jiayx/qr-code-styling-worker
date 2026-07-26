import BaseQRCodeStyling from "qr-code-styling";
import type {
  DownloadOptions,
  FileExtension,
  Options,
} from "qr-code-styling";
import {
  clearWorkerCanvasErrors,
  throwWorkerCanvasErrors,
  type WorkerCanvasModule,
} from "./cloudflare-canvas.js";
import {
  clearWorkerRuntimeErrors,
  throwWorkerRuntimeErrors,
  WorkerJSDOM,
  type WorkerJSDOMConstructor,
} from "./worker-jsdom.js";

export * from "./cloudflare-canvas.js";
export * from "./constants.js";
export * from "./image-resource-store.js";
export * from "./worker-jsdom.js";
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
  GetNeighbor,
  Gradient,
  GradientType,
  GradientTypes,
  Mode,
  Options,
  QRCode,
  RotateFigureArgs,
  ShapeType,
  ShapeTypes,
  TypeNumber,
  UnknownObject,
  Window,
} from "qr-code-styling";

export interface WorkerOptions extends Omit<Options, "jsdom" | "nodeCanvas"> {
  jsdom?: WorkerJSDOMConstructor;
  nodeCanvas?: WorkerCanvasModule;
}

function shouldUseWorkerDOM(): boolean {
  return typeof window === "undefined" || typeof document === "undefined";
}

function toUpstreamOptions(
  options: Partial<WorkerOptions> | undefined,
  injectDefaultDOM: boolean,
): Partial<Options> | undefined {
  if (!options && !injectDefaultDOM) return undefined;

  const adapted: Partial<WorkerOptions> = { ...options };
  if (injectDefaultDOM && shouldUseWorkerDOM()) {
    if (!adapted.jsdom) adapted.jsdom = WorkerJSDOM;
    if (!adapted.nodeCanvas && adapted.type === "canvas") {
      throw new Error(
        "Canvas rendering in a Worker requires nodeCanvas: createCloudflareCanvas(env.IMAGES)",
      );
    }
    if (!adapted.nodeCanvas && adapted.type === undefined) {
      adapted.type = "svg";
    }
  }

  // qr-code-styling deliberately accepts runtime jsdom/nodeCanvas modules,
  // but its declarations name concrete Node packages. The Worker adapters
  // implement the exact runtime surface consumed by version 1.9.2.
  return adapted as Partial<Options>;
}

function getMimeType(extension: FileExtension): string {
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

export default class QRCodeStyling extends BaseQRCodeStyling {
  #serverRuntime: boolean;
  #workerCanvas?: WorkerCanvasModule;

  constructor(options?: Partial<WorkerOptions>) {
    super(toUpstreamOptions(options, true));
    this.#serverRuntime = Boolean(options?.jsdom) || shouldUseWorkerDOM();
    this.#workerCanvas = options?.nodeCanvas;
  }

  override update(options?: Partial<WorkerOptions>): void {
    if (!options) {
      super.update();
      return;
    }

    clearWorkerRuntimeErrors(this._window);
    clearWorkerCanvasErrors(this.#workerCanvas);
    if (options.nodeCanvas) this.#workerCanvas = options.nodeCanvas;
    if (options.type === "canvas" && !this.#workerCanvas) {
      throw new Error(
        "Canvas rendering in a Worker requires nodeCanvas: createCloudflareCanvas(env.IMAGES)",
      );
    }
    super.update(toUpstreamOptions(options, false));
  }

  override async getRawData(extension: FileExtension = "png"): Promise<Blob | null> {
    if (!this._qr) {
      throw new Error("QR code is empty");
    }

    if (extension.toLowerCase() === "svg") {
      const element = await this._getElement("svg");
      throwWorkerRuntimeErrors(this._window);
      if (!element) return null;

      const serializer = new this._window.XMLSerializer();
      const source = serializer.serializeToString(element as SVGElement);
      const svg = `<?xml version="1.0" standalone="no"?>\r\n${source}`;
      return new Blob([svg], { type: getMimeType("svg") });
    }

    if (!this.#workerCanvas) {
      throw new Error(
        `Cannot export ${extension.toUpperCase()} without nodeCanvas: createCloudflareCanvas(env.IMAGES)`,
      );
    }

    const raw = await super.getRawData(extension);
    throwWorkerRuntimeErrors(this._window);
    throwWorkerCanvasErrors(this.#workerCanvas);

    if (raw === null || raw instanceof Blob) return raw;
    throw new Error(
      "The configured nodeCanvas returned a Node.js Buffer; qr-code-styling-worker expects a Worker Blob",
    );
  }

  async getSvgString(): Promise<string> {
    const raw = await this.getRawData("svg");
    if (!raw) throw new Error("QR code is empty");
    return raw.text();
  }

  override async download(
    downloadOptions?: Partial<DownloadOptions> | string,
  ): Promise<void> {
    if (this.#serverRuntime) {
      throw new Error(
        "Cannot download in a Worker runtime; call getRawData() and return the Blob in a Response",
      );
    }
    await super.download(downloadOptions);
  }
}

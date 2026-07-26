import { parseHTML } from "linkedom/worker";
import {
  ImageResourceStore,
  bytesToDataUrl,
  type ImageResourceStoreOptions,
} from "./image-resource-store.js";

const runtimeStateKey = Symbol("qr-code-styling-worker.runtime-state");

interface WorkerRuntimeState {
  errors: Error[];
  store: ImageResourceStore;
}

type UnknownRecord = Record<PropertyKey, unknown>;

export interface WorkerJSDOMInstance {
  readonly window: object;
}

export interface WorkerJSDOMConstructor {
  new (html?: string, options?: unknown): WorkerJSDOMInstance;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function findRuntimeState(window: unknown): WorkerRuntimeState | null {
  const record = asRecord(window);
  const state = record?.[runtimeStateKey];
  const stateRecord = asRecord(state);
  if (!stateRecord || !Array.isArray(stateRecord.errors)) return null;
  return state as WorkerRuntimeState;
}

export function throwWorkerRuntimeErrors(window: unknown): void {
  const errors = findRuntimeState(window)?.errors;
  if (!errors?.length) return;

  const first = errors[0] ?? new Error("Unknown Worker runtime adapter error");
  throw new Error(`QR image loading failed: ${first.message}`, { cause: first });
}

export function clearWorkerRuntimeErrors(window: unknown): void {
  const state = findRuntimeState(window);
  if (state) state.errors.length = 0;
}

class WorkerXMLSerializer {
  serializeToString(node: unknown): string {
    const record = asRecord(node);
    if (typeof record?.toString !== "function") {
      throw new TypeError("XMLSerializer expected a DOM node");
    }
    return String(record.toString());
  }
}

function createImageClass(state: WorkerRuntimeState) {
  return class WorkerImage {
    crossOrigin?: string;
    height = 0;
    naturalHeight = 0;
    naturalWidth = 0;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    width = 0;

    #requestId = 0;
    #src = "";

    get src(): string {
      return this.#src;
    }

    set src(value: string) {
      this.#src = value;
      const requestId = ++this.#requestId;

      void state.store
        .load(value)
        .then((resource) => {
          if (requestId !== this.#requestId) return;
          this.#src = resource.dataUrl;
          this.width = this.naturalWidth = resource.width;
          this.height = this.naturalHeight = resource.height;
          this.onload?.();
        })
        .catch((error: unknown) => {
          if (requestId !== this.#requestId) return;
          state.errors.push(toError(error));
          this.onerror?.();

          // qr-code-styling 1.9.2 does not register image.onerror. Calling
          // onload releases its drawing promise; the wrapper throws the
          // recorded error before returning data to the caller.
          this.onload?.();
        });
    }
  };
}

function createXMLHttpRequestClass(state: WorkerRuntimeState) {
  return class WorkerXMLHttpRequest {
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    response: Blob = new Blob();
    responseType = "";
    status = 0;

    #method = "GET";
    #url = "";

    open(method: string, url: string): void {
      this.#method = method.toUpperCase();
      this.#url = url;
    }

    send(): void {
      if (this.#method !== "GET") {
        const error = new Error(`Unsupported XMLHttpRequest method: ${this.#method}`);
        state.errors.push(error);
        this.onerror?.();
        this.onload?.();
        return;
      }

      void state.store
        .load(this.#url)
        .then((resource) => {
          this.status = 200;
          this.response = new Blob([resource.bytes.slice().buffer], {
            type: resource.mimeType,
          });
          this.onload?.();
        })
        .catch((error: unknown) => {
          state.errors.push(toError(error));
          this.status = 0;
          this.response = new Blob();
          this.onerror?.();

          // Release qr-code-styling's XHR/FileReader promise. The recorded
          // failure is surfaced by throwWorkerRuntimeErrors().
          this.onload?.();
        });
    }
  };
}

function createFileReaderClass(state: WorkerRuntimeState) {
  return class WorkerFileReader {
    onerror: (() => void) | null = null;
    onloadend: (() => void) | null = null;
    result: string | ArrayBuffer | null = null;

    readAsDataURL(blob: Blob): void {
      void blob
        .arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          this.result = bytesToDataUrl(
            bytes,
            blob.type || "application/octet-stream",
          );
        })
        .catch((error: unknown) => {
          state.errors.push(toError(error));
          this.onerror?.();
        })
        .finally(() => {
          this.onloadend?.();
        });
    }
  };
}

export function createWorkerJSDOM(
  options: ImageResourceStoreOptions = {},
): WorkerJSDOMConstructor {
  return class WorkerJSDOM {
    readonly window: object;

    constructor(html = "") {
      const state: WorkerRuntimeState = {
        errors: [],
        store: new ImageResourceStore(options),
      };
      const parsed = parseHTML(html);
      // linkedom's worker build exposes browser constructors through a shared
      // global proxy. An own wrapper keeps request-specific adapters and error
      // state isolated while inheriting the complete DOM surface.
      const windowRecord = Object.create(parsed) as UnknownRecord;
      Object.defineProperty(windowRecord, "document", {
        configurable: false,
        enumerable: true,
        value: parsed.document,
        writable: false,
      });

      Object.defineProperty(windowRecord, runtimeStateKey, {
        configurable: false,
        enumerable: false,
        value: state,
        writable: false,
      });
      Object.defineProperties(windowRecord, {
        FileReader: {
          configurable: false,
          value: createFileReaderClass(state),
          writable: false,
        },
        Image: {
          configurable: false,
          value: createImageClass(state),
          writable: false,
        },
        XMLHttpRequest: {
          configurable: false,
          value: createXMLHttpRequestClass(state),
          writable: false,
        },
        XMLSerializer: {
          configurable: false,
          value: WorkerXMLSerializer,
          writable: false,
        },
      });

      this.window = windowRecord;
    }
  };
}

export const WorkerJSDOM = createWorkerJSDOM();

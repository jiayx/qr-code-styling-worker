import { encodeMatrix } from "./encoder.js";
import { diagnoseQr, throwUnsafeQr } from "./diagnostics.js";
import {
  ImageResourceStore,
  type ImageResourceStoreOptions,
} from "./image-resource-store.js";
import { mergeOptions } from "./options.js";
import { createSvgRoot, renderSvg } from "./svg-renderer.js";
import { normalizeSeamOverlap, type SvgRenderingOptions } from "./svg-rendering.js";
import type { Options } from "./types.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

class StringSvgElement {
  readonly ownerDocument: StringSvgDocument;
  readonly tagName: string;
  readonly #attributes = new Map<string, string>();
  readonly #children: StringSvgElement[] = [];
  #parent?: StringSvgElement;
  textContent: string | null = null;

  constructor(ownerDocument: StringSvgDocument, tagName: string) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
  }

  get firstChild(): StringSvgElement | null {
    return this.#children[0] ?? null;
  }

  appendChild(child: StringSvgElement): StringSvgElement {
    child.remove();
    child.#parent = this;
    this.#children.push(child);
    return child;
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  remove(): void {
    if (!this.#parent) return;
    const index = this.#parent.#children.indexOf(this);
    if (index >= 0) this.#parent.#children.splice(index, 1);
    this.#parent = undefined;
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name, value);
  }

  toString(): string {
    const attributes = Array.from(this.#attributes)
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .join("");
    const content = `${this.textContent ? escapeText(this.textContent) : ""}${
      this.#children.map((child) => child.toString()).join("")
    }`;
    return content
      ? `<${this.tagName}${attributes}>${content}</${this.tagName}>`
      : `<${this.tagName}${attributes}/>`;
  }
}

class StringSvgDocument {
  readonly baseURI: string;

  constructor(baseURI: string) {
    this.baseURI = baseURI;
  }

  createElementNS(namespace: string, name: string): StringSvgElement {
    if (namespace !== SVG_NAMESPACE) throw new Error(`Unsupported namespace: ${namespace}`);
    return new StringSvgElement(this, name);
  }
}

export interface SvgStringOptions extends ImageResourceStoreOptions {
  /** Base URL used to resolve relative logo sources. */
  baseUrl?: string;
}

export interface SvgStringRenderOptions extends Options {
  svgOptions?: SvgRenderingOptions;
}

function createImageClass(store: ImageResourceStore, baseUrl: string) {
  return class StringRendererImage {
    crossOrigin?: string;
    height = 0;
    naturalHeight = 0;
    naturalWidth = 0;
    onerror: ((event?: Event) => void) | null = null;
    onload: (() => void) | null = null;
    width = 0;
    #src = "";

    get src(): string {
      return this.#src;
    }

    set src(value: string) {
      const resolved = value.startsWith("data:") ? value : new URL(value, baseUrl).href;
      void store.load(resolved).then((resource) => {
        this.#src = resource.dataUrl;
        this.width = this.naturalWidth = resource.width;
        this.height = this.naturalHeight = resource.height;
        this.onload?.();
      }).catch((error: unknown) => {
        this.onerror?.({ error } as Event & { error: unknown });
      });
    }
  };
}

class StringXmlSerializer {
  serializeToString(node: unknown): string {
    if (!node || typeof (node as { toString?: unknown }).toString !== "function") {
      throw new TypeError("XMLSerializer expected an SVG node");
    }
    return String(node);
  }
}

export interface StringSvgRuntime {
  document: Document;
  Image: new () => HTMLImageElement;
  XMLSerializer: new () => XMLSerializer;
}

/** @internal Shared by the class API's server runtime. */
export function createStringSvgRuntime(
  store: ImageResourceStore,
  baseUrl = "http://localhost/",
): StringSvgRuntime {
  const document = new StringSvgDocument(baseUrl);
  return {
    document: document as unknown as Document,
    Image: createImageClass(store, baseUrl) as unknown as new () => HTMLImageElement,
    XMLSerializer: StringXmlSerializer as unknown as new () => XMLSerializer,
  };
}

function stableRenderId(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `s${(hash >>> 0).toString(36)}`;
}

/**
 * Generates standalone SVG without a browser DOM or general-purpose DOM shim.
 * Extension hooks remain class-only because this function returns text.
 */
export async function renderSvgString(
  options: Partial<SvgStringRenderOptions>,
  runtimeOptions: SvgStringOptions = {},
): Promise<string> {
  const { svgOptions, ...renderOptions } = options;
  const resolved = mergeOptions(undefined, { ...renderOptions, type: "svg" }, true);
  if (!resolved.data) throw new Error("QR code is empty");
  const baseUrl = runtimeOptions.baseUrl ?? "http://localhost/";
  const store = new ImageResourceStore(runtimeOptions);
  const runtime = createStringSvgRuntime(store, baseUrl);
  const svg = createSvgRoot(runtime, resolved);
  const matrix = encodeMatrix(resolved.data, resolved.qrOptions);
  throwUnsafeQr(diagnoseQr(matrix, resolved));
  normalizeSeamOverlap(svgOptions?.seamOverlap);
  await renderSvg(
    svg,
    matrix,
    resolved,
    runtime,
    store,
    stableRenderId(JSON.stringify(options)),
  );
  return `<?xml version="1.0" standalone="no"?>\r\n${String(svg)}`;
}

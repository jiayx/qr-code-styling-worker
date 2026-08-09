# qr-code-styling-worker

An independent QR styling library and SVG renderer with an API compatible with
[`qr-code-styling`](https://github.com/kozakdenys/qr-code-styling). It is built
for browsers and Cloudflare Workers, with QR-aware geometry that stays clean at
fractional module sizes.

Try it at [`qr.tools.tf`](https://qr.tools.tf/).

## Features

- **Seam-free contour rendering.** Connected modules become compound paths with
  shared edges removed, avoiding rasterization gaps without overlaps or integer
  module sizing.
- **Smaller SVG, less rasterization work.** Collinear edges are collapsed,
  circular modules are grouped, finder patterns use direct geometry, and
  optional definitions are emitted only when needed. One validation sample
  shrank by 72%, from 31,483 to 8,831 bytes, with 4 paths instead of 116.
- **First-class Worker output.** Generate SVG directly with no binding, or use a
  Cloudflare Images binding for PNG, JPEG, and WebP.
- **Controlled QR encoding.** Automatic Numeric, Alphanumeric, and UTF-8 Byte
  segmentation, smallest-version fitting, automatic or fixed mask selection,
  and public encoding metadata.
- **Safer customization.** Built-in checks cover quiet zone, module size,
  contrast, and logo coverage; remote logos are bounded, timed, deduplicated,
  and can be embedded into self-contained SVGs.
- **Familiar API, clearer geometry.** Existing `qr-code-styling` options and
  primary methods remain compatible, while canonical shape names describe the
  rendered result directly.

## Rendering architecture

Text is segmented and encoded using low-level primitives from
[`qr`](https://github.com/paulmillr/qr), then passed through this package's own
matrix adapter, contour tracer, finder renderer, paint system, and SVG
serializer. The same renderer powers the browser class API and the DOM-free
`renderSvgString()` Worker path.

| Area | Behavior | Benefit |
| --- | --- | --- |
| Contours | Trace only exposed module edges and collapse straight runs | No internal seams; fewer path commands |
| Rounded modules | Round only true outer corners after neighboring modules are known | Smooth joins without bumps or overlap patches |
| Finder patterns | Render rings and centers as dedicated paths | Stable, smooth geometry independent of module styling |
| SVG serialization | Format coordinates while generating geometry and emit optional markup only when needed | Compact output without floating-point noise or unused definitions |
| Worker runtime | Use a small internal SVG representation shared by both APIs | Direct server rendering without browser globals or a general-purpose DOM |
| Resource pipeline | Bound, validate, cache, and propagate failures from logo and raster operations | Predictable behavior for remote assets and Cloudflare Images |

These optimizations happen before serialization rather than as a final minify
step. The renderer first builds the module topology, removes internal edges,
rounds only exposed corners, merges compatible geometry, and then writes the
shortest equivalent paths. Browsers therefore receive fewer elements, path
commands, and clip operations while the exact QR layout and margin are kept.

The image loader defaults to a 5 MiB source limit and a 10 second timeout.
Those limits are configurable per renderer instance. Raster output is the only
feature that requires a Cloudflare binding; SVG output remains binding-free.

SVG coordinates are formatted while geometry is generated. The exported
`normalizeSvgCoordinates()` helper remains available for backward compatibility
with callers that want to normalize extension-produced geometry; it only visits
known geometry attributes and does not rewrite colors, IDs, URLs, or embedded
image data. In the same 320 px validation sample, line segments use compact
horizontal and vertical commands, and clip paths fell from 8 to 0. The size and
element counts are illustrative rather than a guaranteed compression ratio;
they vary with content and styling.

## Version history

### `1.0.0` and later

`1.0.0` introduced the independent implementation described above. It owns the
public class, encoding policy, rendering, serialization, logo handling,
diagnostics, and export pipeline. Compatibility refers to the documented
`qr-code-styling` API, not its internal DOM structure or implementation.

`1.0.1` further compacts contour paths, avoids duplicate embedded-logo data,
and preserves fractional linear-gradient coordinates.

### `0.2.1` and earlier

`0.2.1` is the final release of the original compatibility port and remains
available for applications that require its exact rendering behavior:

```sh
npm install qr-code-styling-worker@0.2.1
```

That line is frozen at
[`legacy-port-v0.2.1`](https://github.com/jiayx/qr-code-styling-worker/tree/legacy-port-v0.2.1).

## Install

```sh
pnpm add qr-code-styling-worker
```

Or with npm:

```sh
npm install qr-code-styling-worker
```

## Shape names and compatibility

New code should describe the geometry that is actually rendered:

```ts
import {
  finderCenterShapes,
  finderFrameShapes,
  moduleShapes,
} from "qr-code-styling-worker";

const options = {
  dotsOptions: { type: moduleShapes.diagonalExtraRounded },
  cornersSquareOptions: { type: finderFrameShapes.circle },
  cornersDotOptions: { type: finderCenterShapes.circle },
};
```

Legacy `qr-code-styling` shape values remain accepted at the public API boundary
and are normalized before rendering:

| Legacy value | Canonical value |
| --- | --- |
| data module `dots` | `circle` |
| data module `classy` | `diagonal-rounded` |
| data module `classy-rounded` | `diagonal-extra-rounded` |
| finder frame/center `dot` | `circle` |

`dotTypes`, `cornerSquareTypes`, `cornerDotTypes`, and the `DotType`,
`CornerSquareType`, and `CornerDotType` unions remain available for source
compatibility. The legacy constant objects intentionally expose only their
`qr-code-styling` keys; canonical values live exclusively in the new shape
objects. Prefer `ModuleShape`, `FinderFrameShape`, and `FinderCenterShape` in new
integrations.

## SVG in a Worker

No binding is required:

```ts
import QRCodeStyling from "qr-code-styling-worker";

export default {
  async fetch(): Promise<Response> {
    const qr = new QRCodeStyling({
      width: 512,
      height: 512,
      type: "svg",
      data: "https://example.com",
      dotsOptions: {
        type: "diagonal-extra-rounded",
        gradient: {
          type: "linear",
          rotation: Math.PI / 4,
          colorStops: [
            { offset: 0, color: "#2563eb" },
            { offset: 1, color: "#7c3aed" },
          ],
        },
      },
      cornersSquareOptions: { type: "extra-rounded" },
    });

    const image = await qr.getRawData("svg");
    return new Response(image, {
      headers: { "content-type": "image/svg+xml; charset=utf-8" },
    });
  },
};
```

`type` defaults to `canvas` for API compatibility. In Workers, it defaults to
`svg` only when neither `type` nor a canvas adapter is supplied, so the usual
`new QRCodeStyling({ data })` constructor remains useful without browser globals.

### DOM-free SVG strings

For server code that does not need `append()` or DOM extension hooks, generate
the SVG string directly:

```ts
import { renderSvgString } from "qr-code-styling-worker";

const svg = await renderSvgString({
  width: 512,
  height: 512,
  margin: 48,
  data: "https://example.com/order/12345678901234567890",
  dotsOptions: { type: "rounded", roundSize: false },
});

return new Response(svg, {
  headers: { "content-type": "image/svg+xml; charset=utf-8" },
});
```

The package has no general-purpose DOM runtime dependency. Both the class API
and `renderSvgString()` use the same small internal SVG representation on the
server, so a separate `/svg` entry point is unnecessary. Relative logo URLs can
be resolved with the second argument:

```ts
await renderSvgString(options, {
  baseUrl: "https://assets.example/",
  fetch,
  maxImageBytes: 2 * 1024 * 1024,
  timeoutMs: 5_000,
});
```

`applyExtension()` remains available through the class API. In browsers it
receives a native `SVGElement`; on the server it receives the package's minimal
SVG-compatible element, which supports the construction methods used by the
renderer but is not a complete browser DOM.

### Seam-free fractional SVG modules

Keeping `dotsOptions.roundSize` disabled preserves the exact requested margin
and can produce fractional module coordinates. The contour renderer removes
shared edges before SVG rasterization, so it does not need to round module
sizes or overlap adjacent elements:

```ts
const qr = new QRCodeStyling({
  width: 320,
  height: 320,
  margin: 48,
  data: "https://example.com",
  dotsOptions: {
    type: "extra-rounded",
    roundSize: false,
  },
});
```

`svgOptions.seamOverlap` remains accepted and validated for compatibility, but
is otherwise ignored. For every
non-`circle` family, only exposed contour edges are emitted and rounding applies
only to true outer corners. Intentionally separate `circle` modules remain visually
separate but are serialized as subpaths of one compound path. Logo-hidden
modules are removed before tracing.

Generated geometry is formatted to at most six decimal places, turning
binary floating-point artifacts such as `194.55999999999997` into `194.56`.
This does not round module sizes to integers.

## Encoder metadata and safety diagnostics

When `qrOptions.mode` is omitted, the encoder automatically separates useful
Numeric and Alphanumeric runs from UTF-8 Byte data. Short runs remain in Byte
mode when a mode switch would cost more bits than it saves. An explicit mode
continues to disable automatic segmentation.

```ts
const qr = new QRCodeStyling({
  data: "order-12345678901234567890-PAID",
  margin: 32,
  type: "svg",
});

const metadata = qr.getMetadata();
// version, mask, moduleCount, moduleSize, quietZoneModules, segments, ...

const diagnostics = qr.getDiagnostics();
// { safe, metadata, issues }
```

Diagnostics warn by default. Strict mode rejects output when a configured
threshold is violated:

```ts
const qr = new QRCodeStyling({
  data,
  safetyOptions: {
    mode: "strict",
    minQuietZoneModules: 4,
    minModuleSize: 3,
    minContrast: 3,
    maxLogoCoverage: 0.12,
  },
});
```

These checks catch common configuration mistakes; they do not replace testing
the final artwork with the target scanners and print/display conditions.

## Frames, captions, and styled logos

```ts
const qr = new QRCodeStyling({
  data,
  margin: 48,
  accessibilityOptions: {
    title: "Website QR code",
    description: "Scan to open the example website",
  },
  frameOptions: {
    type: "rounded",
    width: 4,
    radius: 24,
    color: "#2563eb",
    text: "SCAN TO OPEN",
    textColor: "#111827",
    fontSize: 16,
  },
  image,
  imageOptions: {
    margin: 6,
    backgroundColor: "#fff",
    shape: "rounded",
    opacity: 0.9,
  },
});
```

Frames and captions are drawn in the existing canvas margin; reserve enough
margin to keep them outside the QR quiet zone.

## Awaitable and cancellable rendering

The constructor remains compatible and starts rendering immediately. New code
can explicitly await completion:

```ts
const controller = new AbortController();
const qr = await QRCodeStyling.render(options, {
  signal: controller.signal,
  onComplete: ({ metadata }) => console.log(metadata.version),
  onError: console.error,
});

await qr.updateAsync({ data: nextData });
await qr.ready();
```

Cancellation stops waiting for an obsolete result. It does not assume that an
already-dispatched remote image request can be cancelled by every runtime.

## PNG, JPEG, and WebP

Add an Images binding:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "qr-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-26",
  "compatibility_flags": ["nodejs_compat"],
  "images": {
    "binding": "IMAGES",
    "remote": true
  }
}
```

Generate binding types after changing the config:

```sh
pnpm wrangler types
```

Then pass the Worker-specific adapter in `canvasAdapter`:

```ts
import QRCodeStyling, {
  createCloudflareCanvas,
} from "qr-code-styling-worker";

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const qr = new QRCodeStyling({
      width: 512,
      height: 512,
      data: "https://example.com",
      type: "canvas",
      canvasAdapter: createCloudflareCanvas(env.IMAGES),
    });

    const image = await qr.getRawData("png");
    return new Response(image, {
      headers: { "content-type": "image/png" },
    });
  },
};
```

The Images binding is needed only for raster output. It may incur Cloudflare
Images usage charges.

## Remote logos and limits

`image` accepts data URLs and absolute HTTP(S) URLs; browsers also resolve
relative URLs against the document base URL. Each renderer instance deduplicates
requests and defaults to:

- 5 MiB maximum source image size
- 10 second fetch timeout
- PNG, JPEG, GIF, WebP, SVG, and AVIF MIME types

`imageOptions.saveAsBlob` defaults to `true` for API compatibility. A
remote image is fetched and embedded as a data URL. Set it to `false` to keep
the original URL in the SVG; the image is still loaded once to calculate its
layout. Browser requests remain subject to the remote server's CORS policy.
Embedded images use the SVG `href` attribute once rather than duplicating the
same payload in the legacy `xlink:href` attribute.

Customize those controls:

```ts
import { createCloudflareCanvas } from "qr-code-styling-worker";

const resourceOptions = {
  maxImageBytes: 2 * 1024 * 1024,
  timeoutMs: 5_000,
};

const canvasAdapter = createCloudflareCanvas(env.IMAGES, {
  maxImageBytes: 2 * 1024 * 1024,
  timeoutMs: 5_000,
});

const qr = new QRCodeStyling({
  data,
  image,
  resourceOptions,
  canvasAdapter,
});
```

## Compatibility notes

The class, most option names, constants, and primary methods target source-level
compatibility with `qr-code-styling` 1.9.2. The generated SVG DOM is deliberately
different: direct compound paths replace its per-module figures and clip paths.
Extensions that query `qr-code-styling` internal child IDs or element ordering
must be updated.

Compatibility stops at the documented public surface. Underscored implementation
members such as `_options`, `_qr`, `_getElement`, and `_setupSvg` are intentionally
not exposed. The renderer uses private fields and its own internal `QrMatrix`
interface; the exported `QRCode` type remains source-compatible for callers that
use it independently.

Environment-specific behaviors are explicit:

- `download()` cannot initiate a browser download in a Worker. Use
  `getRawData()` and return the Blob in a `Response`.
- Raster output needs `createCloudflareCanvas(env.IMAGES)`. SVG output is
  self-contained.
- The `jsdom` option is accepted as a deprecated compatibility field but
  ignored. Server SVG rendering uses the built-in lightweight serializer;
  `WorkerJSDOM`, `createWorkerJSDOM`, and the `linkedom` runtime dependency are
  intentionally not provided.
- The `nodeCanvas` compatibility option is intentionally unsupported. This
  package does not accept the native npm `canvas` module or return Node `Buffer`
  raster output. Its Worker-only injection point is named `canvasAdapter` to
  avoid implying node-canvas compatibility. In a regular Node process, generate
  SVG and use a separate rasterizer such as Sharp when PNG/JPEG/WebP is required.

`append()` remains present for API compatibility but is normally irrelevant in
a server response. Compact QR Kanji segments are intentionally not implemented;
the `Kanji` option falls back to UTF-8 Byte encoding so existing payloads remain
representable.

The optional `qrOptions.mask` extension accepts an integer from `0` through `7`
when a stable mask pattern is required. When omitted, the encoder evaluates all
eight patterns and selects the lowest-penalty mask, which remains the default.

## Development

```sh
pnpm install
pnpm check
```

Tests run with `@cloudflare/vitest-pool-workers`, not a Node-only DOM shim.

The optional real-browser raster regression downloads PNGs in both Chromium
and WebKit and decodes each result again:

```sh
pnpm exec playwright install chromium-headless-shell webkit
pnpm test:browser
```

## License

MIT. Third-party licenses and compatibility acknowledgements are listed in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

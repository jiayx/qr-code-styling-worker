# qr-code-styling-worker

An independent QR encoder and seam-free SVG contour renderer with a
[`qr-code-styling`](https://github.com/kozakdenys/qr-code-styling) compatible
API. It runs in browsers and Cloudflare Workers without depending on
`qr-code-styling` or `qrcode-generator`.

## Features

- The same default export and `update`, `append`,
  `applyExtension`, `deleteExtension`, `getRawData`, and `download` method
  signatures as upstream.
- Compatible option names for error-correction levels, dot/corner styles,
  gradients, square/circle shapes, embedded images, and SVG callbacks.
- Canonical, shape-based enums (`moduleShapes`, `finderFrameShapes`, and
  `finderCenterShapes`) with deprecated upstream names isolated as aliases.
- A maintained, zero-dependency QR encoder with a public matrix API.
- Automatic Numeric, Alphanumeric, and UTF-8 Byte segmentation, plus public
  version, mask, segment, and layout metadata.
- Scan-safety diagnostics for quiet zone, module size, contrast, and estimated
  logo coverage, with optional strict rejection.
- A DOM-free `renderSvgString()` API for server and Worker hot paths.
- Connected QR modules emitted as direct compound paths instead of hundreds of
  independently rasterized clip-path figures.
- Collinear contour vertices removed, so long module runs serialize as one
  edge instead of one command per module.
- Separate circular dots combined into one compound path rather than one SVG
  element per module.
- Circle-shaped output built from explicit outer decoration modules with a
  one-module moat around the real QR matrix, without clipping core geometry.
- SVG output without any Cloudflare binding.
- Seam-free SVG output without expanding modules or changing QR margins.
- SVG geometry normalized to at most six decimal places.
- PNG, JPEG, and WebP output through a Cloudflare Images binding.
- Bounded, timed, deduplicated loading of HTTP(S) and data-URL images.
- Declarative frames, captions, and logo background, opacity, and clipping.
- Optional SVG title, description, role, and ARIA linkage for accessible output.
- Awaitable rendering with completion/error callbacks and `AbortSignal`.
- Tested inside the actual `workerd` runtime.

## Architecture and improvements

The package retains the familiar class API but owns the complete rendering
pipeline: text is encoded by [`qr`](https://github.com/paulmillr/qr), adapted to
a small matrix interface, traced into QR-aware contours, and emitted directly
as SVG. Canvas and Worker raster output consume that SVG.

| Area | Behavior | Benefit |
| --- | --- | --- |
| Encoder | Builds Numeric, Alphanumeric, and UTF-8 Byte segments, fits the smallest version, selects or honors a mask, and uses `qr` for low-level QR primitives | Mixed payloads can use smaller symbols while metadata reports the exact encoding decisions |
| Data modules | Traces only exposed edges, removes collinear vertices, and emits compound paths for connected regions | Shared module edges do not exist and straight runs stay compact |
| Separate dots | Emits all circular data modules as subpaths of one compound path | Preserves intentional separation without creating hundreds of DOM nodes |
| Circle shape | Adds deterministic outer decoration modules separated from the real matrix by a one-module moat | Preserves the circular silhouette without clipping modules or interfering with finder detection |
| Finder patterns | Draws the three finder rings and dots as dedicated direct geometry | Finder styling remains independent without clip-path duplication |
| Paint | Applies solid colors and user-space gradients directly to paths | SVGs contain fewer elements and are simpler for browsers to rasterize |
| Worker SVG runtime | Uses a small internal SVG tree and serializer shared by the class and string APIs | Server rendering needs neither browser globals nor a general-purpose DOM package |
| Runtime isolation | Creates image caches per renderer instance and propagates asynchronous failures directly | Request-specific failures and resources are not stored in shared module-level state |
| Worker defaults | Defaults to SVG only in a Worker when neither `type` nor a canvas adapter is provided | `new QRCodeStyling({ data })` remains useful without silently pretending raster support exists |
| Image loading | Accepts data URLs and absolute HTTP(S) URLs, deduplicates identical loads, applies a timeout, validates MIME types, and rejects oversized inputs while streaming | Remote logos are bounded and failures surface instead of leaving a drawing promise pending |
| Self-contained logos | Honors `imageOptions.saveAsBlob` in browsers and Workers; enabled remote images are converted to data URLs | Downloaded SVGs do not depend on the original logo URL |
| Image metadata | Reads dimensions from SVG, PNG, JPEG, GIF, and WebP sources and converts loaded bytes to data URLs | Compatible image sizing and self-contained SVG logo embedding continue to work in a Worker |
| Raster output | Implements a minimal canvas surface and delegates encoding to a Cloudflare Images binding | PNG, JPEG, and WebP are available without native `canvas` dependencies |
| Standalone SVG | Adds the default SVG namespace before serialization | Opening an `/image` response directly renders an image instead of exposing XML text |
| DOM-free SVG | Uses the same minimal internal SVG tree in `QRCodeStyling` and `renderSvgString()` | Server rendering does not need browser globals, linkedom, or XMLSerializer |
| SVG serialization | Formats geometry when paths and attributes are generated, with at most six decimal places | Binary floating-point artifacts never enter the generated DOM, and no final DOM rewrite is needed |
| SVG metadata | Emits `defs` and the XLink namespace only when gradients or images need them | Plain solid SVG output avoids unused markup |
| Extension hooks | Calls `applyExtension()` after the independent SVG is complete | Application extensions remain usable without coupling the renderer to upstream DOM structure |
| Failure propagation | Propagates image and canvas adapter failures through rendering promises and `getRawData()` | Fetch, image decode, quota, and transformation failures do not become silent null output |
| Safety diagnostics | Reports layout and encoder metadata and checks quiet zone, module size, contrast, and logo coverage | Applications can warn users or reject risky QR configurations before export |
| Compatibility | Re-exports compatible option types and constants and runs migrated upstream `1.9.2` cases | Common callers can switch packages without changing their construction and update code |
| Verification | Runs migrated upstream cases, contour-topology tests, matrix decode tests, Worker tests, and real Chromium/WebKit PNG download-and-decode regression | API behavior, QR correctness, and both browser rasterizers are checked independently |

The image loader defaults to a 5 MiB source limit and a 10 second timeout.
Those limits are configurable per renderer instance. Raster output is the only
feature that requires a Cloudflare binding; SVG output remains binding-free.

SVG coordinates are formatted while geometry is generated. The exported
`normalizeSvgCoordinates()` helper remains available for backward compatibility
with callers that want to normalize extension-produced geometry; it only visits
known geometry attributes and does not rewrite colors, IDs, URLs, or embedded
image data. In the repository's
320 px validation sample, the independent renderer reduced
the complete SVG from 31,483 bytes to 16,312 bytes, paths from 116 to 4, and
clip paths from 8 to 0. This measurement is illustrative rather than a
guaranteed compression ratio.

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

The old qr-code-styling values remain accepted at the public boundary and are
normalized before rendering:

| Legacy value | Canonical value |
| --- | --- |
| data module `dots` | `circle` |
| data module `classy` | `diagonal-rounded` |
| data module `classy-rounded` | `diagonal-extra-rounded` |
| finder frame/center `dot` | `circle` |

`dotTypes`, `cornerSquareTypes`, `cornerDotTypes`, and the `DotType`,
`CornerSquareType`, and `CornerDotType` unions remain available for source
compatibility. The legacy constant objects intentionally expose only their
upstream keys; canonical values live exclusively in the new shape objects.
Prefer `ModuleShape`, `FinderFrameShape`, and `FinderCenterShape` in new
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

The compatible default `type` is `canvas`. In Workers, this package defaults to
`svg` only when neither `type` nor a canvas adapter is supplied, so the usual
`new QRCodeStyling({ data })` constructor remains useful without browser
globals.

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
  svgOptions: {
    seamOverlap: 0.2,
  },
});
```

`svgOptions.seamOverlap` remains accepted for compatibility and diagnostics,
but the independent renderer does not use it to enlarge geometry. For every
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

`imageOptions.saveAsBlob` defaults to `true`, matching the compatible API. A
remote image is fetched and embedded as a data URL. Set it to `false` to keep
the original URL in the SVG; the image is still loaded once to calculate its
layout. Browser requests remain subject to the remote server's CORS policy.

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
different: direct compound paths replace upstream clip paths and per-module
figures. Extensions that query upstream-specific child IDs or element ordering
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
- The upstream `jsdom` option is accepted as a deprecated compatibility field
  but ignored. Server SVG rendering uses the built-in lightweight serializer;
  `WorkerJSDOM`, `createWorkerJSDOM`, and the `linkedom` runtime dependency are
  intentionally not provided.
- The upstream `nodeCanvas` option is intentionally unsupported. This package
  does not accept the native npm `canvas` module or return Node `Buffer` raster
  output. Its Worker-only injection point is named `canvasAdapter` to avoid
  implying node-canvas compatibility. In a regular Node process, generate SVG
  and use a separate rasterizer such as Sharp when PNG/JPEG/WebP is required.

`append()` remains present for API compatibility but is normally irrelevant in
a server response. Compact QR Kanji segments are intentionally not implemented;
the compatible `Kanji` option falls back to UTF-8 Byte encoding so existing
payloads remain representable.

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

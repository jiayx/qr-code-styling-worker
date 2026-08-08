# qr-code-styling-worker

Cloudflare Workers runtime adapters for
[`qr-code-styling`](https://github.com/kozakdenys/qr-code-styling). The public
class and option types stay aligned with upstream `1.9.2`; the browser DOM and
Canvas dependencies are replaced with Worker-safe adapters.

## Features

- The same default export, constructor options, `update`, `append`,
  `applyExtension`, `deleteExtension`, `getRawData`, and `download` method
  signatures as upstream.
- All upstream QR modes, error-correction levels, dot/corner styles, gradients,
  square/circle shapes, embedded images, and SVG extension callbacks.
- SVG output without any Cloudflare binding.
- Optional SVG seam suppression without changing QR margins.
- SVG geometry normalized to at most six decimal places.
- PNG, JPEG, and WebP output through a Cloudflare Images binding.
- Bounded, timed, deduplicated loading of HTTP(S) and data-URL images.
- Tested inside the actual `workerd` runtime.

## What this port improves

This package keeps the `qr-code-styling` rendering API and styling behavior,
then adds a narrow compatibility and reliability layer for Cloudflare Workers.
It does not maintain a separate QR encoder or a divergent figure renderer.

| Area | Port behavior | Benefit |
| --- | --- | --- |
| Worker DOM | Uses the worker build of `linkedom` and supplies the `Image`, `XMLHttpRequest`, `FileReader`, and `XMLSerializer` surfaces consumed by upstream | SVG rendering works without browser globals or Node-only JSDOM |
| Runtime isolation | Creates adapter state, image caches, and deferred error storage per adapter instance | Request-specific failures and resources are not stored in shared module-level state |
| Worker defaults | Defaults to SVG only in a Worker when neither `type` nor a canvas adapter is provided | `new QRCodeStyling({ data })` remains useful without silently pretending raster support exists |
| Image loading | Accepts data URLs and absolute HTTP(S) URLs, deduplicates identical loads, applies a timeout, validates MIME types, and rejects oversized inputs while streaming | Remote logos are bounded and failures are surfaced instead of hanging the upstream drawing promise |
| Image metadata | Reads dimensions from SVG, PNG, JPEG, GIF, and WebP sources and converts loaded bytes to data URLs | Upstream image sizing and self-contained SVG logo embedding continue to work in a Worker |
| Raster output | Implements the minimal canvas surface used by upstream and delegates encoding to a Cloudflare Images binding | PNG, JPEG, and WebP are available without native `canvas` dependencies |
| Standalone SVG | Adds the default SVG namespace before serialization | Opening an `/image` response directly renders an image instead of exposing XML text |
| Fractional modules | Optionally overlaps the final painted dots layer when `roundSize` is disabled | Browser anti-aliasing seams are suppressed without changing the SVG size, view box, or margin calculation |
| SVG serialization | Normalizes known geometry attributes to at most six decimal places | Binary floating-point artifacts are removed and SVG output is smaller and easier to diff |
| Extension hooks | Composes the internal SVG fixes with upstream `applyExtension()` and `deleteExtension()` | Application extensions remain usable without disabling the port fixes |
| Failure propagation | Records asynchronous DOM/canvas adapter failures and throws them from `getRawData()` | Fetch, image decode, quota, and transformation failures do not become silent null output |
| Compatibility | Pins the tested upstream version and re-exports upstream option types and runtime constants | Upstream behavior is preserved while internal-interface changes are caught during upgrades |
| Verification | Runs lint, type checking, packaging checks, and the rendering suite inside `workerd` | Worker-specific incompatibilities are tested outside a Node-only DOM environment |

The image loader defaults to a 5 MiB source limit and a 10 second timeout.
Those limits are configurable per adapter instance. Raster output is the only
feature that requires a Cloudflare binding; SVG output remains binding-free.

SVG coordinate normalization is deliberately limited to geometry attributes
such as `d`, `transform`, `viewBox`, `x`, `y`, `width`, and `height`. It does
not rewrite colors, IDs, URLs, or embedded image data. In the repository's
320 px validation sample, normalization reduced the SVG from 35,108 bytes to
27,470 bytes while leaving the decoded QR payload unchanged. This measurement
is illustrative rather than a guaranteed compression ratio.

## Install

```sh
pnpm add qr-code-styling-worker
```

Or with npm:

```sh
npm install qr-code-styling-worker
```

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
        type: "classy-rounded",
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

The upstream default `type` is `canvas`. In Workers, this package defaults to
`svg` only when neither `type` nor a canvas adapter is supplied, so the usual
`new QRCodeStyling({ data })` constructor remains useful without browser
globals.

### Fractional SVG modules

Keeping `dotsOptions.roundSize` disabled preserves the requested margin, but
adjacent SVG clip-path shapes can show hairline anti-aliasing seams at some
browser zoom levels. Enable a small overlap to suppress those seams without
rounding the module size:

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

`seamOverlap` accepts SVG-unit values from `0` through `0.5` and defaults to
`0` for upstream-compatible output. It creates four tiny translated copies of
the final painted layer for multi-shape clip paths and only when `roundSize` is
explicitly `false`. The SVG dimensions, view box, and margin calculation are
not changed.

Generated geometry is also normalized to at most six decimal places, turning
binary floating-point artifacts such as `194.55999999999997` into `194.56`.
This does not round module sizes to integers.

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

Then pass the adapter in the upstream `nodeCanvas` option:

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
      nodeCanvas: createCloudflareCanvas(env.IMAGES),
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

`image` accepts the same data URLs and absolute HTTP(S) URLs as upstream. Each
adapter instance deduplicates requests and defaults to:

- 5 MiB maximum source image size
- 10 second fetch timeout
- PNG, JPEG, GIF, WebP, SVG, and AVIF MIME types

Customize those controls:

```ts
import {
  createCloudflareCanvas,
  createWorkerJSDOM,
} from "qr-code-styling-worker";

const jsdom = createWorkerJSDOM({
  maxImageBytes: 2 * 1024 * 1024,
  timeoutMs: 5_000,
});

const nodeCanvas = createCloudflareCanvas(env.IMAGES, {
  maxImageBytes: 2 * 1024 * 1024,
  timeoutMs: 5_000,
});

const qr = new QRCodeStyling({ data, image, jsdom, nodeCanvas });
```

## Compatibility notes

The package and its upstream dependency use independent semantic versioning:

| qr-code-styling-worker | qr-code-styling | Status |
| --- | --- | --- |
| 0.1.x | 1.9.2 | Fully tested |
| 0.2.x | 1.9.2 | Fully tested; adds Worker SVG rendering fixes |

`qr-code-styling` is pinned to an exact version because the Worker adapters use
some upstream internal rendering interfaces. Upstream versions are upgraded
only after the complete workerd compatibility test suite passes. A
`qr-code-styling-worker` version therefore does not correspond directly to an
upstream `qr-code-styling` version.

The rendering API is intentionally kept compatible with the tested upstream
version. Two environment-specific behaviors are explicit:

- `download()` cannot initiate a browser download in a Worker. Use
  `getRawData()` and return the Blob in a `Response`.
- Raster output needs `createCloudflareCanvas(env.IMAGES)`. SVG output is
  self-contained.

`append()` remains present for API compatibility but is normally irrelevant in
a server response. Options and renderer behavior come from the pinned upstream
dependency, so upstream fixes can be adopted without maintaining a divergent
renderer fork.

## Development

```sh
pnpm install
pnpm check
```

Tests run with `@cloudflare/vitest-pool-workers`, not a Node-only DOM shim.

## License

MIT. `qr-code-styling` and `linkedom` remain separate dependencies under their
respective licenses; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

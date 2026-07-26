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
- PNG, JPEG, and WebP output through a Cloudflare Images binding.
- Bounded, timed, deduplicated loading of HTTP(S) and data-URL images.
- Tested inside the actual `workerd` runtime.

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

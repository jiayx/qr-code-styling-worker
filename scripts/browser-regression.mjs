import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium, webkit } from "playwright";
import sharp from "sharp";
import decodeQR from "qr/decode.js";
import { build } from "esbuild";

const repositoryRoot = resolve(import.meta.dirname, "..");
const payload = "https://tools.tf/browser-render-regression";
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const bundle = await build({
  bundle: true,
  entryPoints: [resolve(repositoryRoot, "dist/index.js")],
  format: "esm",
  platform: "browser",
  write: false,
});

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/") {
      response.setHeader("content-type", mimeTypes[".html"]);
      response.end(`<!doctype html><script type="module">
        import QRCodeStyling from "/bundle.js";
        window.QRCodeStyling = QRCodeStyling;
        window.ready = true;
      </script>`);
      return;
    }
    if (pathname === "/bundle.js") {
      response.setHeader("content-type", mimeTypes[".js"]);
      response.end(bundle.outputFiles[0].contents);
      return;
    }
    const path = resolve(repositoryRoot, `.${pathname}`);
    if (!path.startsWith(`${repositoryRoot}${sep}`)) throw new Error("invalid path");
    response.setHeader("content-type", mimeTypes[extname(path)] ?? "application/octet-stream");
    response.end(await readFile(path));
  } catch (error) {
    response.statusCode = 404;
    response.end(error instanceof Error ? error.message : "not found");
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to start test server");
const origin = `http://127.0.0.1:${address.port}`;

const scenarios = [
  {
    name: "contour",
    options: {
      dotsOptions: {
        roundSize: false,
        type: "extra-rounded",
        gradient: {
          type: "linear",
          colorStops: [
            { offset: 0, color: "#2563eb" },
            { offset: 1, color: "#0891b2" },
          ],
        },
      },
      cornersSquareOptions: { type: "extra-rounded" },
    },
  },
  {
    name: "module-circle",
    options: { dotsOptions: { roundSize: false, type: "circle" } },
  },
  {
    name: "circle",
    options: {
      shape: "circle",
      dotsOptions: { roundSize: false, type: "rounded" },
    },
  },
  {
    name: "circle-logo-frame",
    options: {
      frameOptions: {
        color: "#2563eb",
        radius: 24,
        text: "SCAN TO OPEN",
        textColor: "#111827",
        type: "rounded",
        width: 4,
      },
      image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='24'%3E%3Crect width='40' height='24' rx='5' fill='%23ef4444'/%3E%3C/svg%3E",
      imageOptions: {
        backgroundColor: "#ffffff",
        hideBackgroundDots: true,
        imageSize: 0.25,
        margin: 4,
        opacity: 0.9,
        saveAsBlob: true,
        shape: "rounded",
      },
      shape: "circle",
      dotsOptions: { roundSize: false, type: "diagonal-extra-rounded" },
    },
  },
];

try {
  for (const [browserName, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ acceptDownloads: true });
      await page.goto(origin);
      await page.waitForFunction(() => window.ready === true);

      for (const scenario of scenarios) {
        const metadata = await page.evaluate(async ({ data, options }) => {
          const qr = new window.QRCodeStyling({
            data,
            width: 512,
            height: 512,
            margin: 64,
            type: "canvas",
            qrOptions: { errorCorrectionLevel: "H" },
            ...options,
          });
          const blob = await qr.getRawData("png");
          if (!(blob instanceof Blob)) throw new Error("PNG output is not a Blob");
          window.currentQr = qr;
          return { size: blob.size, type: blob.type };
        }, { data: payload, options: scenario.options });
        if (metadata.type !== "image/png" || metadata.size === 0) {
          throw new Error(`${browserName}/${scenario.name}: invalid PNG Blob`);
        }

        const downloadPromise = page.waitForEvent("download");
        await page.evaluate((name) => window.currentQr.download({ name, extension: "png" }), scenario.name);
        const download = await downloadPromise;
        const path = await download.path();
        if (!path) throw new Error(`${browserName}/${scenario.name}: missing download`);
        const image = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const decoded = decodeQR({
          data: image.data,
          width: image.info.width,
          height: image.info.height,
        });
        if (decoded !== payload) {
          throw new Error(`${browserName}/${scenario.name}: decoded ${JSON.stringify(decoded)}`);
        }
        console.log(`${browserName}/${scenario.name}: ${metadata.size} bytes, decoded`);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

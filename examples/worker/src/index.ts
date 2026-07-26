import QRCodeStyling, {
  createCloudflareCanvas,
} from "../../../src/index.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const extension = url.searchParams.get("format") === "svg" ? "svg" : "png";
    const data = url.searchParams.get("data") || "https://example.com";

    const qr = new QRCodeStyling({
      data,
      type: extension === "svg" ? "svg" : "canvas",
      nodeCanvas:
        extension === "svg" ? undefined : createCloudflareCanvas(env.IMAGES),
      dotsOptions: { type: "rounded", color: "#111827" },
      cornersSquareOptions: { type: "extra-rounded", color: "#2563eb" },
    });
    const image = await qr.getRawData(extension);

    return new Response(image, {
      headers: {
        "cache-control": "public, max-age=3600",
        "content-type":
          extension === "svg" ? "image/svg+xml; charset=utf-8" : "image/png",
      },
    });
  },
};

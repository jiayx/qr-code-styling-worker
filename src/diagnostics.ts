import type { QrMatrix, QrSegment } from "./encoder.js";
import type { ResolvedOptions } from "./options.js";

const errorCorrectionPercent = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };

export type DiagnosticCode =
  | "contrast"
  | "logo-coverage"
  | "module-size"
  | "quiet-zone"
  | "transparent-background";

export interface QrDiagnostic {
  code: DiagnosticCode;
  message: string;
  severity: "warning" | "error";
}

export interface QrMetadata {
  dataBytes: number;
  darkModuleCount: number;
  errorCorrectionLevel: string;
  mask: number;
  moduleCount: number;
  moduleSize: number;
  quietZoneModules: number;
  segments: readonly QrSegment[];
  version: number;
  xOffset: number;
  yOffset: number;
}

export interface QrDiagnostics {
  issues: QrDiagnostic[];
  metadata: QrMetadata;
  safe: boolean;
}

interface Rgb {
  blue: number;
  green: number;
  red: number;
}

function parseColor(value: string): Rgb | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim())?.[1];
  if (hex) {
    const normalized = hex.length === 3
      ? Array.from(hex, (character) => character.repeat(2)).join("")
      : hex;
    if (normalized.length === 8 && normalized.slice(6) === "00") return null;
    return {
      red: Number.parseInt(normalized.slice(0, 2), 16),
      green: Number.parseInt(normalized.slice(2, 4), 16),
      blue: Number.parseInt(normalized.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i.exec(value.trim());
  if (!rgb || rgb[4] === "0") return null;
  return { red: Number(rgb[1]), green: Number(rgb[2]), blue: Number(rgb[3]) };
}

function luminance(color: Rgb): number {
  const channel = (value: number) => {
    const normalized = Math.min(255, Math.max(0, value)) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.red) +
    0.7152 * channel(color.green) +
    0.0722 * channel(color.blue);
}

function contrast(left: Rgb, right: Rgb): number {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05);
}

export function getQrMetadata(matrix: QrMatrix, options: ResolvedOptions): QrMetadata {
  const count = matrix.getModuleCount();
  const availableSize = Math.min(options.width, options.height) - 2 * options.margin;
  const qrSize = options.shape === "circle" ? availableSize / Math.sqrt(2) : availableSize;
  const moduleSize = options.dotsOptions.roundSize
    ? Math.floor(qrSize / count)
    : qrSize / count;
  const xOffset = options.dotsOptions.roundSize
    ? Math.floor((options.width - count * moduleSize) / 2)
    : (options.width - count * moduleSize) / 2;
  const yOffset = options.dotsOptions.roundSize
    ? Math.floor((options.height - count * moduleSize) / 2)
    : (options.height - count * moduleSize) / 2;
  const quietPixels = options.shape === "circle"
    ? options.margin
    : Math.min(xOffset, yOffset, options.width - xOffset - count * moduleSize,
      options.height - yOffset - count * moduleSize);
  return {
    dataBytes: new TextEncoder().encode(options.data).length,
    darkModuleCount: matrix.darkModuleCount,
    errorCorrectionLevel: options.qrOptions.errorCorrectionLevel,
    mask: matrix.mask,
    moduleCount: count,
    moduleSize,
    quietZoneModules: moduleSize > 0 ? quietPixels / moduleSize : 0,
    segments: matrix.segments,
    version: matrix.version,
    xOffset,
    yOffset,
  };
}

export function diagnoseQr(matrix: QrMatrix, options: ResolvedOptions): QrDiagnostics {
  const metadata = getQrMetadata(matrix, options);
  const safety = options.safetyOptions;
  const severity = safety.mode === "strict" ? "error" : "warning";
  const issues: QrDiagnostic[] = [];
  if (metadata.quietZoneModules < safety.minQuietZoneModules) {
    issues.push({
      code: "quiet-zone",
      message: `Quiet zone is ${metadata.quietZoneModules.toFixed(2)} modules; recommended minimum is ${safety.minQuietZoneModules}`,
      severity,
    });
  }
  if (metadata.moduleSize < safety.minModuleSize) {
    issues.push({
      code: "module-size",
      message: `Module size is ${metadata.moduleSize.toFixed(2)} px; recommended minimum is ${safety.minModuleSize} px`,
      severity,
    });
  }

  const background = parseColor(options.backgroundOptions.color);
  if (!background) {
    issues.push({
      code: "transparent-background",
      message: "A transparent or unrecognized background cannot guarantee QR contrast",
      severity,
    });
  } else {
    const foregrounds = options.dotsOptions.gradient?.colorStops.map((stop) => stop.color) ??
      [options.dotsOptions.color];
    const ratios = foregrounds
      .map(parseColor)
      .filter((color): color is Rgb => color !== null)
      .map((color) => contrast(color, background));
    if (!ratios.length || Math.min(...ratios) < safety.minContrast) {
      issues.push({
        code: "contrast",
        message: `Foreground/background contrast is below the configured ${safety.minContrast}:1 minimum`,
        severity,
      });
    }
  }

  if (options.image) {
    const estimatedCoverage = options.imageOptions.imageSize *
      errorCorrectionPercent[options.qrOptions.errorCorrectionLevel];
    if (estimatedCoverage > safety.maxLogoCoverage) {
      issues.push({
        code: "logo-coverage",
        message: `Estimated logo coverage ${(estimatedCoverage * 100).toFixed(1)}% exceeds the configured ${(safety.maxLogoCoverage * 100).toFixed(1)}% limit`,
        severity,
      });
    }
  }
  return { issues, metadata, safe: issues.length === 0 };
}

export function throwUnsafeQr(diagnostics: QrDiagnostics): void {
  const errors = diagnostics.issues.filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(`Unsafe QR configuration: ${errors.map((issue) => issue.message).join("; ")}`);
}

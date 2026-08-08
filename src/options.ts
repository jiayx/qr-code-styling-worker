import type {
  DrawType,
  ErrorCorrectionLevel,
  FinderCenterShape,
  FinderFrameShape,
  Gradient,
  Mask,
  Mode,
  ModuleShape,
  Options,
  ShapeType,
  TypeNumber,
} from "./types.js";
import {
  normalizeFinderCenterShape,
  normalizeFinderFrameShape,
  normalizeModuleShape,
} from "./shapes.js";

export interface ResolvedOptions extends Options {
  accessibilityOptions: {
    description: string;
    title: string;
  };
  type: DrawType;
  shape: ShapeType;
  width: number;
  height: number;
  margin: number;
  safetyOptions: {
    mode: "warn" | "strict";
    maxLogoCoverage: number;
    minContrast: number;
    minModuleSize: number;
    minQuietZoneModules: number;
  };
  data: string;
  qrOptions: {
    typeNumber: TypeNumber;
    mode?: Mode;
    errorCorrectionLevel: ErrorCorrectionLevel;
    mask?: Mask;
  };
  imageOptions: {
    backgroundColor?: string;
    saveAsBlob: boolean;
    hideBackgroundDots: boolean;
    imageSize: number;
    crossOrigin?: string;
    margin: number;
    opacity: number;
    shape: "circle" | "rounded" | "square";
  };
  dotsOptions: {
    type: ModuleShape;
    color: string;
    gradient?: Gradient;
    roundSize: boolean;
  };
  cornersSquareOptions?: {
    type?: FinderFrameShape;
    color?: string;
    gradient?: Gradient;
  };
  cornersDotOptions?: {
    type?: FinderCenterShape;
    color?: string;
    gradient?: Gradient;
  };
  backgroundOptions: {
    round: number;
    color: string;
    gradient?: Gradient;
  };
  frameOptions: {
    color: string;
    fontSize: number;
    radius: number;
    text: string;
    textColor: string;
    type: "none" | "rounded" | "square";
    width: number;
  };
}

const defaults: ResolvedOptions = {
  accessibilityOptions: {
    description: "",
    title: "",
  },
  type: "canvas",
  shape: "square",
  width: 300,
  height: 300,
  margin: 0,
  data: "",
  safetyOptions: {
    mode: "warn",
    maxLogoCoverage: 0.12,
    minContrast: 3,
    minModuleSize: 3,
    minQuietZoneModules: 4,
  },
  qrOptions: {
    typeNumber: 0,
    errorCorrectionLevel: "Q",
  },
  imageOptions: {
    saveAsBlob: true,
    hideBackgroundDots: true,
    imageSize: 0.4,
    margin: 0,
    opacity: 1,
    shape: "square",
  },
  dotsOptions: {
    type: "square",
    color: "#000",
    roundSize: true,
  },
  backgroundOptions: {
    round: 0,
    color: "#fff",
  },
  frameOptions: {
    color: "#000",
    fontSize: 16,
    radius: 16,
    text: "",
    textColor: "#000",
    type: "none",
    width: 2,
  },
};

function mergeGradient(
  current: Gradient | undefined,
  patch: Gradient | undefined,
  replace: boolean,
): Gradient | undefined {
  if (!replace) return current;
  if (patch === undefined) return undefined;
  if (!patch.colorStops?.length) {
    throw new TypeError("Field 'colorStops' is required in gradient");
  }
  return {
    ...current,
    ...patch,
    colorStops: patch.colorStops.map((stop) => ({
      color: stop.color,
      offset: Number(stop.offset),
    })),
    rotation: Number(patch.rotation ?? 0),
  };
}

export function mergeOptions(
  current: ResolvedOptions | undefined,
  patch: Partial<Options> = {},
  workerRuntime = false,
): ResolvedOptions {
  const base = current ?? defaults;
  const options: ResolvedOptions = {
    ...base,
    ...patch,
    accessibilityOptions: {
      ...base.accessibilityOptions,
      ...patch.accessibilityOptions,
    },
    type: patch.type ?? (current?.type ?? (workerRuntime ? "svg" : defaults.type)),
    width: Number(patch.width ?? base.width),
    height: Number(patch.height ?? base.height),
    margin: Number(patch.margin ?? base.margin),
    safetyOptions: { ...base.safetyOptions, ...patch.safetyOptions },
    qrOptions: { ...base.qrOptions, ...patch.qrOptions },
    imageOptions: { ...base.imageOptions, ...patch.imageOptions },
    dotsOptions: {
      ...base.dotsOptions,
      ...patch.dotsOptions,
      type: normalizeModuleShape(patch.dotsOptions?.type ?? base.dotsOptions.type),
      gradient: mergeGradient(
        base.dotsOptions.gradient,
        patch.dotsOptions?.gradient,
        patch.dotsOptions !== undefined &&
          Object.hasOwn(patch.dotsOptions, "gradient"),
      ),
    },
    cornersSquareOptions: patch.cornersSquareOptions === undefined
      ? base.cornersSquareOptions
      : {
        ...base.cornersSquareOptions,
        ...patch.cornersSquareOptions,
        type: patch.cornersSquareOptions.type === undefined
          ? base.cornersSquareOptions?.type
          : normalizeFinderFrameShape(patch.cornersSquareOptions.type),
        gradient: mergeGradient(
          base.cornersSquareOptions?.gradient,
          patch.cornersSquareOptions.gradient,
          Object.hasOwn(patch.cornersSquareOptions, "gradient"),
        ),
      },
    cornersDotOptions: patch.cornersDotOptions === undefined
      ? base.cornersDotOptions
      : {
        ...base.cornersDotOptions,
        ...patch.cornersDotOptions,
        type: patch.cornersDotOptions.type === undefined
          ? base.cornersDotOptions?.type
          : normalizeFinderCenterShape(patch.cornersDotOptions.type),
        gradient: mergeGradient(
          base.cornersDotOptions?.gradient,
          patch.cornersDotOptions.gradient,
          Object.hasOwn(patch.cornersDotOptions, "gradient"),
        ),
      },
    backgroundOptions: {
      ...base.backgroundOptions,
      ...patch.backgroundOptions,
      gradient: mergeGradient(
        base.backgroundOptions.gradient,
        patch.backgroundOptions?.gradient,
        patch.backgroundOptions !== undefined &&
          Object.hasOwn(patch.backgroundOptions, "gradient"),
      ),
    },
    frameOptions: { ...base.frameOptions, ...patch.frameOptions },
  };

  if (!Number.isFinite(options.width) || options.width <= 0) {
    throw new RangeError("QR width must be a positive number");
  }
  if (!Number.isFinite(options.height) || options.height <= 0) {
    throw new RangeError("QR height must be a positive number");
  }
  options.margin = Math.max(
    0,
    Math.min(options.margin, Math.min(options.width, options.height) / 2),
  );
  options.imageOptions.imageSize = Math.max(
    0,
    Math.min(1, Number(options.imageOptions.imageSize)),
  );
  options.imageOptions.hideBackgroundDots = Boolean(
    options.imageOptions.hideBackgroundDots,
  );
  options.imageOptions.margin = Math.max(0, Number(options.imageOptions.margin));
  options.imageOptions.opacity = Math.max(
    0,
    Math.min(1, Number(options.imageOptions.opacity)),
  );
  options.backgroundOptions.round = Math.max(
    0,
    Math.min(1, Number(options.backgroundOptions.round)),
  );
  options.safetyOptions.maxLogoCoverage = Math.max(
    0,
    Math.min(1, Number(options.safetyOptions.maxLogoCoverage)),
  );
  options.safetyOptions.minContrast = Math.max(1, Number(options.safetyOptions.minContrast));
  options.safetyOptions.minModuleSize = Math.max(0, Number(options.safetyOptions.minModuleSize));
  options.safetyOptions.minQuietZoneModules = Math.max(
    0,
    Number(options.safetyOptions.minQuietZoneModules),
  );
  options.frameOptions.width = Math.max(0, Number(options.frameOptions.width));
  options.frameOptions.radius = Math.max(0, Number(options.frameOptions.radius));
  options.frameOptions.fontSize = Math.max(1, Number(options.frameOptions.fontSize));
  return options;
}

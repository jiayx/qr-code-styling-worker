/** Canonical names for the visible shape of data modules. */
export type ModuleShape =
  | "circle"
  | "rounded"
  | "diagonal-rounded"
  | "diagonal-extra-rounded"
  | "square"
  | "extra-rounded";

/** @deprecated Use the equivalent ModuleShape value. */
export type LegacyDotType = "dots" | "classy" | "classy-rounded";

/**
 * qr-code-styling-compatible module type. New code should prefer ModuleShape.
 */
export type DotType = ModuleShape | LegacyDotType;

/** Canonical names for the visible shape of a finder-pattern frame. */
export type FinderFrameShape = "circle" | "square" | "rounded" | "extra-rounded";

/** Canonical names for the visible shape of a finder-pattern center. */
export type FinderCenterShape = "circle" | "square" | "rounded";

/** @deprecated Use the equivalent FinderCenterShape value. */
export type LegacyCornerDotType = "dot" | "square";

/** qr-code-styling-compatible finder-center type. */
export type CornerDotType = FinderCenterShape | LegacyCornerDotType;

/** @deprecated Use the equivalent FinderFrameShape value. */
export type LegacyCornerSquareType = "dot" | "square" | "extra-rounded";

/** qr-code-styling-compatible finder-frame type. */
export type CornerSquareType = FinderFrameShape | LegacyCornerSquareType;
export type FileExtension = "svg" | "png" | "jpeg" | "webp";
export type GradientType = "radial" | "linear";
export type DrawType = "canvas" | "svg";
export type ShapeType = "square" | "circle";
export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";
export type Mask = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Mode = "Numeric" | "Alphanumeric" | "Byte" | "Kanji";
export type TypeNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
  11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 |
  25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 |
  40;

export interface UnknownObject {
  [key: string]: unknown;
}

export interface Gradient {
  type: GradientType;
  rotation?: number;
  colorStops: Array<{ offset: number; color: string }>;
}

export interface DotTypes {
  [key: string]: DotType;
}
export interface GradientTypes {
  [key: string]: GradientType;
}
export interface CornerDotTypes {
  [key: string]: CornerDotType;
}
export interface CornerSquareTypes {
  [key: string]: CornerSquareType;
}
export interface DrawTypes {
  [key: string]: DrawType;
}
export interface ShapeTypes {
  [key: string]: ShapeType;
}

export interface QRCode {
  addData(data: string, mode?: Mode): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, column: number): boolean;
  createImgTag(cellSize?: number, margin?: number): string;
  createSvgTag(cellSize?: number, margin?: number): string;
  createSvgTag(options?: {
    cellSize?: number;
    margin?: number;
    scalable?: boolean;
  }): string;
  createDataURL(cellSize?: number, margin?: number): string;
  createTableTag(cellSize?: number, margin?: number): string;
  createASCII(cellSize?: number, margin?: number): string;
  renderTo2dContext(
    context: CanvasRenderingContext2D,
    cellSize?: number,
  ): void;
}

export interface JSDOMConstructor {
  new (html?: string, options?: unknown): { readonly window: object };
}

export interface AccessibilityOptions {
  description?: string;
  title?: string;
}

export interface SafetyOptions {
  mode?: "warn" | "strict";
  maxLogoCoverage?: number;
  minContrast?: number;
  minModuleSize?: number;
  minQuietZoneModules?: number;
}

export interface ImageOptions {
  saveAsBlob?: boolean;
  hideBackgroundDots?: boolean;
  imageSize?: number;
  crossOrigin?: string;
  margin?: number;
  backgroundColor?: string;
  opacity?: number;
  shape?: "circle" | "rounded" | "square";
}

export interface FrameOptions {
  color?: string;
  fontSize?: number;
  radius?: number;
  text?: string;
  textColor?: string;
  type?: "none" | "rounded" | "square";
  width?: number;
}

export interface Options {
  accessibilityOptions?: AccessibilityOptions;
  type?: DrawType;
  shape?: ShapeType;
  width?: number;
  height?: number;
  margin?: number;
  data?: string;
  image?: string;
  /** @deprecated Accepted for qr-code-styling source compatibility and ignored. */
  jsdom?: JSDOMConstructor;
  safetyOptions?: SafetyOptions;
  qrOptions?: {
    typeNumber?: TypeNumber;
    mode?: Mode;
    errorCorrectionLevel?: ErrorCorrectionLevel;
    /** Fix the QR mask pattern. Omit to select the lowest-penalty mask. */
    mask?: Mask;
  };
  imageOptions?: ImageOptions;
  dotsOptions?: {
    type?: DotType;
    color?: string;
    gradient?: Gradient;
    roundSize?: boolean;
  };
  cornersSquareOptions?: {
    type?: CornerSquareType;
    color?: string;
    gradient?: Gradient;
  };
  cornersDotOptions?: {
    type?: CornerDotType;
    color?: string;
    gradient?: Gradient;
  };
  backgroundOptions?: {
    round?: number;
    color?: string;
    gradient?: Gradient;
  };
  frameOptions?: FrameOptions;
}

export type DownloadOptions = {
  name?: string;
  extension?: FileExtension;
};
export type ExtensionFunction = (svg: SVGElement, options: Options) => void;
export type FilterFunction = (row: number, column: number) => boolean;
export type GetNeighbor = (x: number, y: number) => boolean;
export type DrawArgs = {
  x: number;
  y: number;
  size: number;
  rotation?: number;
  getNeighbor?: GetNeighbor;
};
export type BasicFigureDrawArgs = Omit<DrawArgs, "getNeighbor">;
export type RotateFigureArgs = BasicFigureDrawArgs & { draw: () => void };
export type Window = object;

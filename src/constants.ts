import type {
  CornerDotType,
  CornerSquareType,
  DotType,
  DrawType,
  ErrorCorrectionLevel,
  GradientType,
  Mode,
  ShapeType,
  TypeNumber,
} from "qr-code-styling";

export const dotTypes = {
  dots: "dots",
  rounded: "rounded",
  classy: "classy",
  classyRounded: "classy-rounded",
  square: "square",
  extraRounded: "extra-rounded",
} as const satisfies Record<string, DotType>;

export const cornerSquareTypes = {
  dot: "dot",
  square: "square",
  extraRounded: "extra-rounded",
} as const satisfies Record<string, CornerSquareType>;

export const cornerDotTypes = {
  dot: "dot",
  square: "square",
} as const satisfies Record<string, CornerDotType>;

export const errorCorrectionLevels = {
  L: "L",
  M: "M",
  Q: "Q",
  H: "H",
} as const satisfies Record<string, ErrorCorrectionLevel>;

export const errorCorrectionPercents = {
  L: 0.07,
  M: 0.15,
  Q: 0.25,
  H: 0.3,
} as const;

export const modes = {
  numeric: "Numeric",
  alphanumeric: "Alphanumeric",
  byte: "Byte",
  kanji: "Kanji",
} as const satisfies Record<string, Mode>;

export const drawTypes = {
  canvas: "canvas",
  svg: "svg",
} as const satisfies Record<string, DrawType>;

export const shapeTypes = {
  square: "square",
  circle: "circle",
} as const satisfies Record<string, ShapeType>;

export const gradientTypes = {
  radial: "radial",
  linear: "linear",
} as const satisfies Record<string, GradientType>;

export const qrTypes = Object.fromEntries(
  Array.from({ length: 41 }, (_, type) => [type, type as TypeNumber]),
) as Record<number, TypeNumber>;

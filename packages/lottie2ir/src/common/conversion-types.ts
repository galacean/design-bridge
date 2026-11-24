import type { IRScene } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type {
  Animation, Layer, Asset, Text, AnimatedProperty,
  Shape,
} from '@lottie-animation-community/lottie-types';

/** Parsed Lottie animation accepted by convertLottieToIR; serialized JSON strings are accepted separately. */
export type LottieJSON = Animation;
export type LottieLayer = Layer.Value;
export type LottieAsset = Asset.Value;
export type LottieVisualLayer =
  Layer.Precomposition | Layer.SolidColor | Layer.Image | Layer.Null | Layer.Shape |
  Layer.Text;
export type LottiePrecompAsset = Asset.Precomposition & { w?: number; h?: number };
export type LottieImageAsset = Asset.Image;
export type LottieFont = Text.Font;
export type LottieGradientData = AnimatedProperty.GradientColors;
export type LottieShapeElement = Shape.Value;

/** ZIP resource map and the JSON directory used to resolve relative resource paths. */
export interface LottieZipResources {
  /** Supported image and font Data URLs keyed by paths relative to the archive root. */
  resources: Record<string, string>;
  /** Parent directory of the selected JSON file, or an empty string for a root-level file. */
  dirPath: string;
}

/** Resource resolution settings; matching ZIP entries take precedence over URL resolution. No network fetch is made. */
export interface LottieToIROptions {
  /** Absolute base for relative image and font paths not found in zipResources. */
  resourceBaseUrl?: string;
  /** Resources extracted from the same ZIP archive as the Lottie JSON. */
  zipResources?: LottieZipResources;
}

/** Conversion output and non-fatal diagnostics. */
export interface LottieToIRResult {
  scene: IRScene;
  /** Reported normalization and fidelity limits; an empty list does not guarantee lossless conversion. */
  diagnostics: ConversionDiagnostic[];
}

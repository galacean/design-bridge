/**
 * html2figma
 *
 * HTML to Figma conversion engine.
 * Extracts scenes from HTML files and converts them to Figma clipboard format.
 */

// ---- Core pipeline ----
export { extractScene, extractSceneDocument, extractSceneDocumentFromProject } from './core/extract-scene';
export type { ExtractSceneOptions } from './core/extract-scene';
export { createCurrentFigmaClipboard, createFigmaClipboard, scenesToFigmaClipboard } from './core/figma-clipboard-node';
export { createFigmaFile } from './core/figma-file-node';
export { validateFigmaFile } from './core/figma-file-validation';
export type { FigmaClipboardResult } from './core/figma-clipboard';
export type { FigmaArchiveImageEntry } from './core/figma-clipboard';
export type { FigmaFileOptions, FigmaFileResult } from './core/figma-file';
export type { FigmaFileValidationReport } from './core/figma-file-validation';
export type { ClipboardBlobKind, ClipboardBlobKindStats, ClipboardBlobStats } from './core/clipboard-blob-store';
export {
  createHTMLSceneDocument,
  HTML_SCENE_DOCUMENT_VERSION,
  isHTMLSceneDocument,
} from './model/html-scene-document';
export type {
  ConversionDiagnostic,
  ConversionDiagnosticSeverity,
  CreateHTMLSceneDocumentOptions,
  HTMLSceneDocument,
  HTMLSceneRuntime,
  HTMLSceneRuntimeKind,
} from './model/html-scene-document';
export {
  createVirtualProject,
  findDefaultEntryPath,
  inferMimeType,
  normalizeProjectPath,
  readVirtualProjectText,
  resolveProjectPath,
} from './model/virtual-project';
export type { VirtualProject, VirtualProjectFile } from './model/virtual-project';

// ---- Utilities ----
export { parseColor, makeSolidPaint, dataUrlToUint8Array, makeImageFillPaint } from './core/paint-helpers';
export { dataUrlToBytes } from './core/paint-helpers-node';
export { extractAndSaveSchema, FILE_SCHEMA_PATH, SCHEMA_PATH } from './core/kiwi-schema-node';
export {
  parseSvgPath,
  svgPathToVectorNetwork,
  encodeVectorNetworkBlob,
  svgPathToBlob,
  svgPathsToBlob,
  parseSvgContent,
} from './core/svg-to-vector';
export {
  positionForIndex,
  buildGridStructures,
  parseGridPlacementHint,
  resolveGridPlacements,
  resetGridTrackIdCounter,
} from './core/grid-handler';
export { enrichSceneForBaseline } from './core/baseline-normalizers';
export { inferFlowAutoLayout, inferSingleChildContainerLayout, resolveAutoLayout } from './core/layout-resolver';

// ---- Types ----
export type {
  SceneNode,
  SceneResult,
  SceneStyles,
  TextCharMetrics,
  RGBA,
  FigmaGUID,
  FigmaMatrix,
  FigmaVector,
  FigmaColorStop,
  FigmaPaint,
  FigmaEffect,
  FigmaNodeChange,
  FigmaBlob,
  GridInfo,
  AutoLayout,
  CornerRadii,
  FigmaIR,
  FigmaIRNodeType,
  FigmaIRSolidFill,
  FigmaIRGradientFill,
  FigmaIREffect,
  FigmaIRAutoLayout,
  FigmaIRBorder,
  FigmaIRCornerRadii,
  FigmaIRTextProps,
  FigmaIRGridPlacement,
  SvgPathCommand,
  VectorVertex,
  VectorSegment,
  VectorNetwork,
  VectorBounds,
  SvgParseResult,
} from './types';

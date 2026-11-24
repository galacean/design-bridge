export { extractSceneFromDocument } from './core/extract-scene-from-document';
export { extractSceneDocumentFromHTML, extractSceneFromHTML } from './browser-runtime';
export type { BrowserExtractSceneOptions } from './browser-runtime';
export {
  createVirtualProjectFromFiles,
  extractSceneDocumentFromProject,
  materializeVirtualProjectHTML,
} from './browser-project';
export type { MaterializedVirtualProject } from './browser-project';
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
export type { SceneNode, SceneResult, SceneStyles, FigmaIR } from './types';
export {
  createVirtualProject,
  findDefaultEntryPath,
  inferMimeType,
  normalizeProjectPath,
  readVirtualProjectText,
  resolveProjectPath,
} from './model/virtual-project';
export type { VirtualProject, VirtualProjectFile } from './model/virtual-project';

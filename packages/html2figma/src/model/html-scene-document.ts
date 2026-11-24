import type { SceneNode } from '../types';
import { collectResourceDiagnostics } from '../core/collect-resource-diagnostics';

/** Current version of the serialized HTML scene document format. */
export const HTML_SCENE_DOCUMENT_VERSION = 1 as const;

/** Runtime used to render and extract HTML. */
export type HTMLSceneRuntimeKind = 'browser' | 'playwright';
/** Severity of an extraction or resource diagnostic. */
export type ConversionDiagnosticSeverity = 'info' | 'warning' | 'error';

/** An extraction observation; diagnostics do not cover every unsupported HTML or CSS feature. */
export interface ConversionDiagnostic {
  /** Diagnostic severity. */
  severity: ConversionDiagnosticSeverity;
  /** Machine-readable identifier, such as `RESOURCE_NOT_FOUND` or `TEXT_RASTERIZED`. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** Optional path relative to the scene root identifying the affected node. */
  nodePath?: string;
}

/** Browser engine metadata recorded during extraction. */
export interface HTMLSceneRuntime {
  /** Browser iframe or Node.js Playwright adapter. */
  kind: HTMLSceneRuntimeKind;
  /** Engine identifier recorded by the extraction adapter. */
  engine: 'chromium';
  /** Engine version, when supplied by the adapter. */
  engineVersion?: string;
  /** User agent of the rendering context, when available. */
  userAgent?: string;
}

/** Versioned HTML extraction result shared by Node.js and browser exporters. */
export interface HTMLSceneDocument {
  /** Scene document format version. */
  version: typeof HTML_SCENE_DOCUMENT_VERSION;
  /** Rendering viewport in CSS pixels, which may differ from the full scene bounds. */
  viewport: { width: number; height: number };
  /** Rendering environment metadata. */
  runtime: HTMLSceneRuntime;
  /** Measured scene tree with semantic Figma properties. */
  root: SceneNode;
  /** Extraction and resource observations; inspect file export validation separately. */
  diagnostics: ConversionDiagnostic[];
}

/** Metadata used when wrapping a scene root in a versioned document. */
export interface CreateHTMLSceneDocumentOptions {
  /** Rendering viewport in CSS pixels. */
  viewport: { width: number; height: number };
  /** Rendering environment metadata. */
  runtime: HTMLSceneRuntime;
  /** Initial observations, followed by resource diagnostics collected from the root. */
  diagnostics?: ConversionDiagnostic[];
}

/**
 * Wraps a scene tree in the current document format and collects resource diagnostics.
 *
 * @param root - Scene root retained by reference.
 * @param options - Viewport, runtime, and optional initial diagnostics, copied into the document.
 * @returns A versioned scene document. This function does not validate or render the input tree.
 */
export function createHTMLSceneDocument(
  root: SceneNode,
  options: CreateHTMLSceneDocumentOptions,
): HTMLSceneDocument {
  return {
    version: HTML_SCENE_DOCUMENT_VERSION,
    viewport: { ...options.viewport },
    runtime: { ...options.runtime },
    root,
    diagnostics: [...(options.diagnostics ?? []), ...collectResourceDiagnostics(root)],
  };
}

/**
 * Checks the current document version, viewport, runtime, root shape, and diagnostic entries.
 *
 * @param value - Value to inspect, such as parsed JSON.
 * @returns Whether the basic document shape matches; nested scene nodes and Figma IR are not deeply validated.
 */
export function isHTMLSceneDocument(value: unknown): value is HTMLSceneDocument {
  if (!isRecord(value) || value.version !== HTML_SCENE_DOCUMENT_VERSION) {
    return false;
  }
  if (!isViewport(value.viewport) || !isRuntime(value.runtime)) {
    return false;
  }
  if (!isSceneNode(value.root) || !Array.isArray(value.diagnostics)) {
    return false;
  }

  return value.diagnostics.every(isDiagnostic);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isViewport(value: unknown): value is HTMLSceneDocument['viewport'] {
  if (!isRecord(value)) {
    return false;
  }

  return isPositiveFiniteNumber(value.width) && isPositiveFiniteNumber(value.height);
}

function isRuntime(value: unknown): value is HTMLSceneRuntime {
  if (!isRecord(value)) {
    return false;
  }

  const validKind = value.kind === 'browser' || value.kind === 'playwright';

  return validKind && value.engine === 'chromium';
}

function isSceneNode(value: unknown): value is SceneNode {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.type === 'string' &&
    typeof value.name === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    Array.isArray(value.children) &&
    isRecord(value.ir)
  );
}

function isDiagnostic(value: unknown): value is ConversionDiagnostic {
  if (!isRecord(value)) {
    return false;
  }

  const validSeverity = value.severity === 'info' || value.severity === 'warning' || value.severity === 'error';

  return validSeverity && typeof value.code === 'string' && typeof value.message === 'string';
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

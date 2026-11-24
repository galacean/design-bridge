import type { IRScene } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type { IRToDSLPreservedData } from '../ir2dsl/types';

/** Warning emitted while converting DSL to Animation IR. */
export interface DSLToIRWarning {
  level: 'warning';
  code: string;
  message: string;
  path?: string;
  layerId?: string;
}

export type DSLToIRWarningInput = Omit<DSLToIRWarning, 'level'>;
export type DSLToIRWarningReporter = (warning: DSLToIRWarningInput) => void;

/** Change reported while converting DSL to an existing Animation IR scene. */
export interface DSLToIRChange {
  kind: 'composition' | 'layer' | 'transform' | 'passthrough' | 'text' | 'asset' | 'timing';
  op: 'set' | 'delete' | 'clear';
  field?: string;
  layerId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  note?: string;
}

export type DSLToIRChangeReporter = (change: DSLToIRChange) => void;

/**
 * One source group or independent particle system placed in the target DSL as an IR Precomp instance.
 * Bind one system or the complete group to root particle leaves with a shared static placement.
 */
export interface DSLParticleSource {
  /** Snapshot paired with the source DSL from which the mapped source IDs were taken. */
  preservedData: IRToDSLPreservedData;
  /** Target DSL layer ID -> source DSL layer ID. */
  layers: Readonly<Record<string, string>>;
  /** Source-pixel region fitted proportionally into the target; defaults to the source canvas and does not clip. */
  authoringBounds?: readonly [x: number, y: number, width: number, height: number];
}

/** Choose fresh conversion or write-back to retained IR, with optional particle source placements. */
export interface DSLToIROptions {
  /** Snapshot returned with the original editable DSL by convertIRToDSL; keep the pair together. */
  preservedData?: IRToDSLPreservedData;
  /** Source instances placed alongside ordinary DSL Layers; array indices identify sourceInstances in the result. */
  particleSources?: readonly DSLParticleSource[];
  /** Receives conversion warnings synchronously; callback errors propagate to the caller. */
  onWarning?: (warning: DSLToIRWarning) => void;
  /** Reports edits during preserved write-back; callback errors propagate to the caller. */
  onChange?: (change: DSLToIRChange) => void;
}

/** Result of converting editable DSL to Animation IR. */
export interface DSLToIRResult {
  scene: IRScene;
  diagnostics: ConversionDiagnostic[];
  /**
   * Present when particle sources are placed. Each entry contains the index into `particleSources` and
   * maps original IR IDs to IDs allocated for that instance, including IDs for source objects omitted from `scene`.
   */
  sourceInstances?: { sourceIndex: number; idMap: Record<string, string> }[];
}

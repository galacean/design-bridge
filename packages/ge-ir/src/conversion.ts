import type { JSONScene } from '@galacean/effects-specification';
import type { IRScene } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type { GEToIRPreservedData } from './preserved-data';

/** Result of importing a GE JSONScene into normalized Animation IR. */
export interface GEToIRResult {
  scene: IRScene;
  /** Keep paired with scene to restore GE-only data during export. */
  preservedData: GEToIRPreservedData;
  diagnostics: ConversionDiagnostic[];
}

/** Result of lowering a normalized Animation IR scene to a GE JSONScene. */
export interface IRToGEResult {
  /** Generated GE Item IDs mapped to their source IR Layer IDs. */
  itemLayerIds: Readonly<Record<string, string>>;
  scene: JSONScene;
  diagnostics: ConversionDiagnostic[];
}

/** GE export settings, including optional restoration of data retained at import. */
export interface IRToGEOptions {
  /** Entry Composition duration in seconds; omission derives it from the IR frame range and frame rate. */
  duration?: number;
  /** Paired GE data; reconcile it with updateGEToIRPreservedData after editing the imported IR. */
  preservedData?: GEToIRPreservedData;
  /** Particle source instances to restore into the supplied IR Scene; each requires trusted GE 3.6 preserved data. */
  sources?: readonly {
    /** Original imported source IR, before placement or edits in the target Scene. */
    scene: IRScene;
    /** GE data paired with this source scene. */
    preservedData: GEToIRPreservedData;
    /** Original source IR IDs mapped to their instance IDs in the target Scene. */
    idMap: Readonly<Record<string, string>>;
    /** Source activity bounds in source pixels; defaults to the imported source metadata. */
    authoringBounds?: readonly [x: number, y: number, width: number, height: number];
    /** Optional mean-alpha overrides in (0, 1], keyed by original ParticleSystem component ID. */
    particleTextureFills?: Readonly<Record<string, number>>;
    /** Automatic sprite-size compensation is enabled by default; false disables it, a positive number fixes the factor. */
    sizeCompensation?: boolean | number;
  }[];
}

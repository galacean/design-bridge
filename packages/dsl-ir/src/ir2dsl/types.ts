import type { IRScene } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type { Composition, Layer } from '../dsl/schema';

export interface IRToDSLLayerMappingEntry {
  irCompositionId: string;
  irLayerId: string;
  expandedSource?: IRToDSLExpandedLayerSource;
}

export interface IRToDSLExpandedLayerSource {
  irCompositionId: string;
  parentLayerId: string;
  baselineTransform: {
    position: Layer['position'];
    scale: Layer['scale'];
    rotation: Layer['rotation'];
    anchor: Layer['anchor'];
    opacity: Layer['opacity'];
  };
  baselineLayer: {
    name: Layer['name'];
    type: Layer['type'];
    width: Layer['width'];
    height: Layer['height'];
    description: Layer['description'];
    parent: Layer['parent'];
    timeRange: Layer['time_range'];
    text?: Layer['text'];
    asset?: Layer['asset'];
    particle?: Layer['particle'];
  };
}

export interface IRToDSLLayerMapping {
  layers: Record<string, IRToDSLLayerMappingEntry>;
}

/**
 * Opaque, JSON-serializable snapshot paired with the DSL returned by convertIRToDSL.
 * Keep it unchanged and pass it to convertDSLToIR to retain data outside the editable DSL subset.
 */
export interface IRToDSLPreservedData {
  readonly baselineScene: IRScene;
  readonly layerMapping: IRToDSLLayerMapping;
}

/** Result of converting Animation IR to editable DSL. */
export interface IRToDSLResult {
  dsl: Composition;
  /** Save with dsl and reuse only for edits derived from that same document. */
  preservedData: IRToDSLPreservedData;
  diagnostics: ConversionDiagnostic[];
}

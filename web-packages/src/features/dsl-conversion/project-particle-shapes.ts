import { parseParticleShape, type Composition, type IRToDSLPreservedData } from '@galacean/dsl-ir';
import type { GEToIRPreservedData } from '@galacean/ge-ir';

/** Add GE-owned emitter geometry to particle DSL as read-only model context. */
export function projectGEParticleShapesToDSL(
  composition: Composition,
  dslPreservedData: IRToDSLPreservedData,
  gePreservedData: GEToIRPreservedData,
): void {
  const pendingLayers = [...composition.layers];

  while (pendingLayers.length > 0) {
    const layer = pendingLayers.pop();

    if (layer == null) {
      continue;
    }
    pendingLayers.push(...(layer.children ?? []));
    if (layer.type !== 'particle' || layer.particle == null) {
      continue;
    }
    const mapping = dslPreservedData.layerMapping.layers[layer.id];
    const rawShape = mapping == null
      ? undefined
      : gePreservedData.compositionBindings[mapping.irCompositionId]
        ?.layerDataById[mapping.irLayerId]?.particleContent?.['shape'];
    const shape = parseParticleShape(rawShape);

    if (shape != null) {
      layer.particle.shape = shape;
    }
  }
}

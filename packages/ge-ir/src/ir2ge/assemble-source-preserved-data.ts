import type { IRScene } from '@galacean/animation-ir';
import type { IRToGEOptions } from '../conversion';
import { isRecord } from '../common/json-normalization';
import {
  assertGEToIRPreservedDataMatchesScene, GE_PRESERVED_DATA_VERSION, type GEToIRPreservedData,
} from '../preserved-data';
import { updateGEToIRPreservedData } from '../update-preserved-data';
import { buildParticleFragment } from '../particle/particle-fragment';
import { appendParticleSourceResources, namespaceParticleSource } from '../particle/assemble-particle-source-data';

/** Reconcile source-local GE payloads with identities already assigned by the IR converter. */
export function assembleSourcePreservedData(scene: IRScene, options: IRToGEOptions): GEToIRPreservedData {
  const result: GEToIRPreservedData = structuredClone(options.preservedData ?? {
    version: GE_PRESERVED_DATA_VERSION, compositionBindings: {},
    particleSourceData: { particleEffectGroups: [], layers: [] },
  });

  for (const input of options.sources ?? []) {
    assertGEToIRPreservedDataMatchesScene(input.scene, input.preservedData);
    const source = input.preservedData;
    const raw = source.sourceScene;

    if (raw == null || raw['version'] !== '3.6') {
      throw new TypeError('[ge-ir:sources] Particle sources require preserved GE 3.6 data.');
    }
    const groups = source.particleSourceData.particleEffectGroups.filter(group =>
      scene.compositions.some(composition => composition.id === input.idMap[group.irCompositionId]),
    );

    if (groups.length !== 1) {
      throw new TypeError('[ge-ir:sources] Each source instance must map exactly one particle composition.');
    }
    const group = groups[0];
    const composition = input.scene.compositions.find(value => value.id === group.irCompositionId);
    const target = scene.compositions.find(value => value.id === input.idMap[group.irCompositionId]);

    if (composition == null || target == null || result.compositionBindings[target.id] != null) {
      throw new TypeError('[ge-ir:sources] Source instance is missing or has duplicate composition bindings.');
    }
    const sourceIds = [composition.id, ...composition.layers.map(layer => layer.id),
      ...input.scene.assets.map(asset => asset.id)];
    const mappedIds = sourceIds.map(id => input.idMap[id]);

    if (mappedIds.some(id => typeof id !== 'string' || id === '') || new Set(mappedIds).size !== mappedIds.length) {
      throw new TypeError('[ge-ir:sources] Source ID mapping must be complete and one-to-one.');
    }
    const particles = source.particleSourceData.layers.filter(binding => binding.effectGroupId === group.id);
    const selected = particles.filter(binding => target.layers.some(layer =>
      layer.id === input.idMap[binding.irLayerId] && layer.type === 'particle',
    ));

    if (selected.length === 0 || (selected.length !== 1 && selected.length !== particles.length)) {
      throw new TypeError('[ge-ir:sources] Source instance must contain one system or its complete group.');
    }
    const fragment = buildParticleFragment(raw, source, {
      effectGroupId: group.id, irCompositionId: group.irCompositionId,
      ...(selected.length !== particles.length && { irLayerId: selected[0].irLayerId }),
    });
    const sourceBinding = source.compositionBindings[composition.id];
    const instance = namespaceParticleSource({
      scene: { ...input.scene, entryCompositionId: composition.id, compositions: [composition] },
      preservedData: {
        version: GE_PRESERVED_DATA_VERSION, sourceScene: fragment,
        compositionBindings: { [composition.id]: structuredClone(sourceBinding) },
        particleSourceData: { particleEffectGroups: [group], layers: particles },
      },
    }, input.idMap);
    const fragmentItems = Array.isArray(fragment['items']) ? fragment['items'].filter(isRecord) : [];
    const retainedItemIds = new Set(fragmentItems.map(item => item['id']));
    const mappedBinding = instance.preservedData.compositionBindings[target.id];

    // Ancestors retained solely for their transforms must not restore a removed renderer.
    for (const layer of target.layers) {
      const original = composition.layers.find(value => input.idMap[value.id] === layer.id);
      const data = mappedBinding.layerDataById[layer.id];

      if (original != null && data != null && original.type !== 'null' && layer.type === 'null') {
        data.sourceHierarchy = 'single-item';
        data.sourceItemIds = sourceBinding.layerDataById[original.id]?.sourceItemIds
          ?.filter(id => retainedItemIds.has(id)).map(id => instance.ids.get(id) ?? id);
      }
    }
    const reconciled = updateGEToIRPreservedData(instance.scene, scene, instance.preservedData);

    appendParticleSourceResources(result, reconciled);
    Object.assign(result.compositionBindings, reconciled.compositionBindings);
    result.particleSourceData.particleEffectGroups.push(...reconciled.particleSourceData.particleEffectGroups);
    result.particleSourceData.layers.push(...reconciled.particleSourceData.layers);
  }
  const hostBinding = result.compositionBindings[scene.entryCompositionId];

  if (hostBinding != null) {
    hostBinding.sourceItemOrder = [];
  }
  assertGEToIRPreservedDataMatchesScene(scene, result);

  return result;
}

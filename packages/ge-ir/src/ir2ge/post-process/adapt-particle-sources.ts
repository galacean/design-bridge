import { DataType } from '@galacean/effects-specification';
import type { IRScene } from '@galacean/animation-ir';
import type { IRToGEOptions, IRToGEResult } from '../../conversion';
import { resolveDataPathId } from '../../common/data-path';
import { isRecord } from '../../common/json-normalization';
import { bakeParticleMotion, type ParticlePlacement } from '../../particle/bake-particle-motion';
import { applyParticleSize, planParticleSize } from '../../particle/compensate-particle-size';
import { particleCameraRatio, particleItemWorld } from '../../particle/map-particle-space';
import { lookupParticleTextureFill } from '../../particle/lookup-particle-texture-fill';
import { particleRecord } from '../../particle/sample-particle-values';

/** Adapt only explicit source placements; an ordinary fidelity round trip keeps its particle simulation untouched. */
export function adaptParticleSources(ir: IRScene, result: IRToGEResult, options: IRToGEOptions): void {
  const scene: unknown = result.scene;

  if (!isRecord(scene)) { throw new TypeError('[ge-ir:particle-layout] Missing generated GE scene.'); }
  const components = records(scene['components']);
  const items = records(scene['items']);
  const itemById = new Map(items.flatMap(item => typeof item['id'] === 'string' ? [[item['id'], item] as const] : []));
  const compositions = records(scene['compositions']);

  for (const input of options.sources ?? []) {
    for (const group of input.preservedData.particleSourceData.particleEffectGroups) {
      const compositionId = input.idMap[group.irCompositionId];
      const placements = ir.compositions.flatMap(host => host.layers.flatMap(layer =>
        layer.type === 'precomp' && layer.content.compositionId === compositionId ? [{ host, layer }] : []));

      if (placements.length === 0) { continue; }
      if (placements.length !== 1) {
        throw new TypeError('[ge-ir:particle-layout] Independent placements require independent source instances.');
      }
      const { host, layer } = placements[0];
      const wrapperItem = items.find(item => typeof item['id'] === 'string' && result.itemLayerIds[item['id']] === layer.id);
      const hostComposition = compositions.find(value => value['id'] === host.id);
      const sourceComposition = compositions.find(value => value['id'] === compositionId);
      const position = layer.transform?.position;
      const scale = layer.transform?.scale;
      const rotation = layer.transform?.rotation;

      if (wrapperItem == null || hostComposition == null || sourceComposition == null ||
        layer.parentId != null || position?.type !== 'static' || scale?.type !== 'static' ||
        Math.abs(scale.value[0] - scale.value[1]) > 1e-9 || Math.abs(scale.value[0] - scale.value[2]) > 1e-9 ||
        scale.value[0] <= 0 || position.value[2] !== 0 ||
        [rotation?.x, rotation?.y].some(axis => axis != null && (axis.type !== 'static' || axis.value !== 0)) ||
        (rotation?.z != null && rotation.z.type !== 'static')) {
        throw new TypeError('[ge-ir:particle-layout] Source wrapper requires a static uniform transform and Z-only rotation.');
      }
      const pixelScale = scale.value[0];
      const ratio = particleCameraRatio(hostComposition);
      const wrapper: ParticlePlacement = {
        scale: pixelScale * ratio / particleCameraRatio(sourceComposition),
        rotation: rotation?.z?.value ?? 0,
        position: [(position.value[0] - host.width / 2) * ratio, (host.height / 2 - position.value[1]) * ratio, 0],
      };
      const sourceLayers = new Map(input.preservedData.particleSourceData.layers
        .filter(binding => binding.effectGroupId === group.id)
        .map(binding => [input.idMap[binding.irLayerId], binding]));
      const systems = components.filter(component => {
        const itemId = resolveDataPathId(component['item']);

        return component['dataType'] === DataType.ParticleSystem && itemId != null &&
          sourceLayers.has(result.itemLayerIds[itemId]);
      });
      const textureFills = new Map<string, number>();
      const raw = input.preservedData.sourceScene;
      const rawComponents = records(raw?.['components']);
      const diagnose = (code: string, message: string, warning = true): void => {
        result.diagnostics.push({ code, message, severity: warning ? 'warning' : 'info',
          action: warning ? 'approximated' : 'normalized', feature: 'particle-layout', sourceId: layer.id,
          path: `$.compositions[id=${JSON.stringify(host.id)}].layers[id=${JSON.stringify(layer.id)}]` });
      };
      let sizeMode = input.sizeCompensation ?? true;

      if (typeof sizeMode === 'number' && (!Number.isFinite(sizeMode) || sizeMode <= 0)) {
        diagnose('GE_PARTICLE_SIZE_COMPENSATION_INVALID', 'Invalid fixed particle size factor; using automatic sizing.');
        sizeMode = true;
      }

      for (const system of systems) {
        const itemId = resolveDataPathId(system['item']);
        const sourceLayer = itemId == null ? undefined : sourceLayers.get(result.itemLayerIds[itemId]);
        const originalId = sourceLayer == null ? undefined : input.preservedData
          .compositionBindings[sourceLayer.irCompositionId]?.layerDataById[sourceLayer.irLayerId]?.sourceComponentId;
        const original = rawComponents.find(component => component['id'] === originalId);
        const id = system['id'];

        if (typeof id !== 'string' || raw == null || originalId == null || original == null) {
          throw new TypeError('[ge-ir:particle-layout] Source ParticleSystem binding is incomplete.');
        }
        if (sizeMode !== true) { continue; }
        const override = input.particleTextureFills?.[originalId];
        const fill = lookupParticleTextureFill(raw, original, override);

        if (override !== undefined && fill.source !== 'given') {
          diagnose('GE_PARTICLE_TEXTURE_FILL_INVALID',
            `ParticleSystem ${originalId}: texture fill override must be in (0, 1]; using source texture lookup.`);
        }

        textureFills.set(id, fill.fill);
        diagnose('GE_PARTICLE_TEXTURE_FILL',
          `ParticleSystem ${String(originalId)}: fill ${fill.fill.toFixed(6)}; source: ${fill.source}.`, false);
        if (fill.missing !== undefined) {
          diagnose('GE_PARTICLE_TEXTURE_FILL_MISSING',
            `ParticleSystem ${String(originalId)}: ${fill.missing}; using solid-disc fill (pi/4). ` +
            'Update the texture fill table or provide particleTextureFills.');
        }
      }
      const bounds = input.authoringBounds ?? group.authoringBounds;

      if (!bounds.every(Number.isFinite) || bounds[0] < 0 || bounds[1] < 0 || bounds[2] <= 0 || bounds[3] <= 0 ||
        bounds[0] + bounds[2] > group.sourcePreviewSize[0] || bounds[1] + bounds[3] > group.sourcePreviewSize[1]) {
        throw new TypeError('[ge-ir:particle-layout] Invalid source activity bounds.');
      }
      const size = planParticleSize(systems, itemById, sourceComposition, bounds, pixelScale, host.width,
        textureFills, sizeMode, {
          scale: wrapper.scale,
          camera: particleRecord(hostComposition['camera']),
          onClipping: (system, plane, time) => diagnose('GE_PARTICLE_DEPTH_CLIPPED',
            `ParticleSystem ${String(system['id'])}: particles may be clipped by the host camera ${plane} plane ` +
            `from about ${time.toFixed(3)}s in the source effect; motion is kept.`),
        });
      const sourceIR = ir.compositions.find(composition => composition.id === compositionId);

      if (sourceIR?.layers.some(sourceLayer => {
        const transform = sourceLayer.transform;

        return [transform?.position, transform?.scale, transform?.rotation?.x, transform?.rotation?.y,
          transform?.rotation?.z].some(property => property != null && property.type !== 'static');
      }) === true) {
        diagnose('GE_PARTICLE_MOTION_APPROXIMATED',
          'Animated source transforms are retained, but motion and sprite-size estimates use the initial transform.');
      }

      setParticleWrapperTransform(scene, wrapperItem, wrapper);
      for (const system of systems) {
        const itemId = resolveDataPathId(system['item']);

        if (itemId == null) { throw new TypeError('[ge-ir:particle-layout] Missing particle Item.'); }
        const world = particleItemWorld(itemById, itemId);

        applyParticleSize(system, size.factor);
        const baked = bakeParticleMotion(system, wrapper, world.matrix, particleRecord(hostComposition['camera']));

        Object.assign(system, baked.system);
        for (const warning of baked.warnings) { diagnose('GE_PARTICLE_MOTION_APPROXIMATED', warning); }
      }
      diagnose('GE_PARTICLE_SIZE_COMPENSATION',
        `Particle size factor ${size.factor.toFixed(4)}; limiting constraint: ${size.limitedBy}.` +
        (size.limits == null ? '' : ` Limits: ${JSON.stringify(size.limits)}.`), false);
    }
  }
}

function setParticleWrapperTransform(
  scene: Record<string, unknown>, item: Record<string, unknown>, wrapper: ParticlePlacement,
): void {
  const [x, y, z] = wrapper.position;

  item['transform'] = { ...particleRecord(item['transform']), position: { x, y, z },
    eulerHint: { x: 0, y: 0, z: wrapper.rotation },
    scale: { x: wrapper.scale, y: wrapper.scale, z: wrapper.scale } };
  const miscs = records(scene['miscs']);
  const byId = new Map(miscs.map(misc => [misc['id'], misc]));
  const bindings = records(scene['components']).flatMap(component => records(component['sceneBindings']))
    .filter(binding => resolveDataPathId(binding['value']) === item['id']);
  const pending = bindings.map(binding => resolveDataPathId(binding['key']));
  const seen = new Set<string>();

  while (pending.length > 0) {
    const id = pending.pop();

    if (id == null || seen.has(id)) { continue; }
    seen.add(id);
    const object = byId.get(id);

    if (object == null) { continue; }
    if (object['dataType'] === DataType.TransformPlayableAsset) {
      object['positionOverLifetime'] = {};
      delete object['rotationOverLifetime'];
      object['sizeOverLifetime'] = { separateAxes: true, x: [0, 1], y: [0, 1], z: [0, 1] };
    }
    const children: unknown[] = Array.isArray(object['children']) ? object['children'] : [];

    pending.push(...children.map(resolveDataPathId), ...records(object['clips']).map(clip => resolveDataPathId(clip['asset'])));
  }
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

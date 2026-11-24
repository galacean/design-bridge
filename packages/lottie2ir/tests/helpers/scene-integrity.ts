import { expect } from 'vitest';

type AnyRecord = Record<string, unknown>;

function getIdSet(list: unknown): Set<string> {
  if (!Array.isArray(list)) {
    return new Set();
  }

  return new Set(
    list
      .map(item => (typeof item === 'object' && item !== null ? (item as AnyRecord).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
}

function getPathId(pathLike: unknown): string | undefined {
  if (typeof pathLike !== 'object' || pathLike === null) {
    return undefined;
  }

  const id = (pathLike as AnyRecord).id;

  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function assertCommonSceneIntegrity(scene: AnyRecord, fileName: string): void {
  expect(scene.type, `${fileName}: scene.type`).toBe('ge');

  const compositions = scene.compositions;
  const items = scene.items;
  const components = scene.components;
  const textures = scene.textures;
  const images = scene.images;
  const miscs = scene.miscs;

  expect(Array.isArray(compositions), `${fileName}: compositions is array`).toBe(true);
  expect(Array.isArray(items), `${fileName}: items is array`).toBe(true);
  expect(Array.isArray(components), `${fileName}: components is array`).toBe(true);
  expect(Array.isArray(textures), `${fileName}: textures is array`).toBe(true);
  expect(Array.isArray(images), `${fileName}: images is array`).toBe(true);
  expect(Array.isArray(miscs), `${fileName}: miscs is array`).toBe(true);

  const compositionList = compositions as AnyRecord[];
  const itemList = items as AnyRecord[];
  const componentList = components as AnyRecord[];
  const textureList = textures as AnyRecord[];
  const miscList = miscs as AnyRecord[];
  const compositionIds = getIdSet(compositionList);

  expect(compositionList.length, `${fileName}: has at least one composition`).toBeGreaterThan(0);

  const compositionId = scene.compositionId;

  expect(typeof compositionId, `${fileName}: compositionId exists`).toBe('string');
  const rootComposition = compositionList.find(comp => comp.id === compositionId);

  expect(rootComposition, `${fileName}: compositionId resolves`).toBeDefined();

  const itemIds = getIdSet(itemList);
  const componentIds = getIdSet(componentList);
  const textureIds = getIdSet(textureList);
  const imageIds = getIdSet(images);
  const miscIds = getIdSet(miscList);

  for (const item of itemList) {
    expect(typeof item.dataType, `${fileName}: item.dataType`).toBe('string');
    expect(typeof item.id, `${fileName}: item.id`).toBe('string');

    const componentRefs = Array.isArray(item.components) ? item.components : [];

    for (const compRef of componentRefs) {
      const compId = getPathId(compRef);

      expect(typeof compId, `${fileName}: item.component ref id`).toBe('string');
      expect(componentIds.has(compId as string), `${fileName}: item.component ref resolves`).toBe(true);
    }

    if (item.parentId !== undefined) {
      expect(typeof item.parentId, `${fileName}: item.parentId type`).toBe('string');
      expect(itemIds.has(item.parentId as string), `${fileName}: item.parentId resolves`).toBe(true);
    }
  }

  for (const component of componentList) {
    expect(typeof component.dataType, `${fileName}: component.dataType`).toBe('string');

    const itemRefId = getPathId(component.item);

    expect(typeof itemRefId, `${fileName}: component.item id`).toBe('string');
    if (component.dataType === 'CompositionComponent') {
      expect(compositionIds.has(itemRefId as string), `${fileName}: composition component.item resolves`).toBe(true);
    } else {
      expect(itemIds.has(itemRefId as string), `${fileName}: component.item resolves`).toBe(true);
    }

    if (component.dataType === 'SpriteComponent') {
      const renderer = component.renderer as AnyRecord | undefined;
      const textureId = getPathId(renderer?.texture);

      if (textureId !== undefined) {
        expect(textureIds.has(textureId), `${fileName}: sprite texture resolves`).toBe(true);
      }
    }

    if (component.dataType === 'ShapeComponent' && component.type === 0) {
      const points = Array.isArray(component.points) ? (component.points as AnyRecord[]) : [];
      const easingIns = Array.isArray(component.easingIns) ? (component.easingIns as AnyRecord[]) : [];
      const easingOuts = Array.isArray(component.easingOuts) ? (component.easingOuts as AnyRecord[]) : [];
      const shapes = Array.isArray(component.shapes) ? (component.shapes as AnyRecord[]) : [];

      expect(shapes.length, `${fileName}: custom shape has shapes`).toBeGreaterThan(0);
      expect(points.length, `${fileName}: custom shape has points`).toBeGreaterThan(0);
      expect(easingIns.length, `${fileName}: custom shape has easingIns`).toBeGreaterThan(0);
      expect(easingOuts.length, `${fileName}: custom shape has easingOuts`).toBeGreaterThan(0);

      for (const shape of shapes) {
        const indexes = Array.isArray(shape.indexes) ? (shape.indexes as AnyRecord[]) : [];

        expect(indexes.length, `${fileName}: custom shape.indexes`).toBeGreaterThan(0);
        for (const index of indexes) {
          const p = Number(index.point);
          const iIn = Number(index.easingIn);
          const iOut = Number(index.easingOut);

          expect(Number.isInteger(p), `${fileName}: point index integer`).toBe(true);
          expect(Number.isInteger(iIn), `${fileName}: easingIn index integer`).toBe(true);
          expect(Number.isInteger(iOut), `${fileName}: easingOut index integer`).toBe(true);
          expect(p >= 0 && p < points.length, `${fileName}: point index range`).toBe(true);
          expect(iIn >= 0 && iIn < easingIns.length, `${fileName}: easingIn index range`).toBe(true);
          expect(iOut >= 0 && iOut < easingOuts.length, `${fileName}: easingOut index range`).toBe(true);
        }
      }
    }
  }

  for (const texture of textureList) {
    const sourceId = getPathId(texture.source);

    expect(typeof sourceId, `${fileName}: texture.source id`).toBe('string');
    expect(imageIds.has(sourceId as string), `${fileName}: texture.source resolves`).toBe(true);
  }

  const compositionComponents = componentList.filter(comp => comp.dataType === 'CompositionComponent');

  expect(compositionComponents.length, `${fileName}: composition component exists`).toBeGreaterThan(0);

  for (const compositionComponent of compositionComponents) {
    const ccItemId = getPathId(compositionComponent.item);

    if (ccItemId !== undefined) {
      const compExists = compositionList.some(comp => comp.id === ccItemId);

      expect(compExists, `${fileName}: composition component.item resolves composition`).toBe(true);
    }

    const timelineAssetId = getPathId(compositionComponent.timelineAsset);

    expect(typeof timelineAssetId, `${fileName}: timelineAsset exists`).toBe('string');
    expect(miscIds.has(timelineAssetId as string), `${fileName}: timelineAsset ref resolves`).toBe(true);

    const timelineAsset = miscList.find(m => m.id === timelineAssetId);
    const tracks = Array.isArray(timelineAsset?.tracks) ? (timelineAsset?.tracks as unknown[]) : [];
    const sceneBindings = Array.isArray(compositionComponent.sceneBindings)
      ? (compositionComponent.sceneBindings as AnyRecord[])
      : [];

    expect(tracks.length, `${fileName}: timeline tracks`).toBeGreaterThan(0);
    expect(sceneBindings.length, `${fileName}: sceneBindings length`).toBeGreaterThan(0);

    for (const trackPath of tracks) {
      const trackId = getPathId(trackPath);

      expect(typeof trackId, `${fileName}: track ref id`).toBe('string');
      expect(miscIds.has(trackId as string), `${fileName}: track ref resolves`).toBe(true);

      const track = miscList.find(m => m.id === trackId);
      const children = Array.isArray(track?.children) ? (track?.children as unknown[]) : [];

      expect(children.length, `${fileName}: object binding has child tracks`).toBeGreaterThan(0);

      for (const childPath of children) {
        const childId = getPathId(childPath);

        expect(typeof childId, `${fileName}: child track ref id`).toBe('string');
        expect(miscIds.has(childId as string), `${fileName}: child track resolves`).toBe(true);

        const childTrack = miscList.find(m => m.id === childId);
        const clips = Array.isArray(childTrack?.clips) ? (childTrack?.clips as AnyRecord[]) : [];

        expect(clips.length, `${fileName}: child track has clips`).toBeGreaterThan(0);
        for (const clip of clips) {
          expect(typeof clip.start, `${fileName}: clip.start type`).toBe('number');
          expect(typeof clip.duration, `${fileName}: clip.duration type`).toBe('number');
          expect((clip.duration as number) > 0, `${fileName}: clip.duration positive`).toBe(true);
          const assetId = getPathId(clip.asset);

          expect(typeof assetId, `${fileName}: clip.asset id`).toBe('string');
          expect(miscIds.has(assetId as string), `${fileName}: clip.asset resolves`).toBe(true);
        }
      }
    }

    for (const binding of sceneBindings) {
      const keyId = getPathId(binding.key);
      const valueId = getPathId(binding.value);

      expect(typeof keyId, `${fileName}: sceneBinding.key`).toBe('string');
      expect(typeof valueId, `${fileName}: sceneBinding.value`).toBe('string');
      expect(miscIds.has(keyId as string), `${fileName}: sceneBinding.key resolves`).toBe(true);
      expect(itemIds.has(valueId as string), `${fileName}: sceneBinding.value resolves`).toBe(true);
    }
  }
}

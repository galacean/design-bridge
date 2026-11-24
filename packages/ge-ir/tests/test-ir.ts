import type {
  IRComposition, IRScene, IRImageContent, IRLayerBase, IRLayerType,
  IRPrecompContent, IRShapeContent, IRSolidContent, IRTextContent,
} from '@galacean/animation-ir';
import {
  createIRScene, createIRResourceSource, resolveIRResourceUrl,
} from '@galacean/animation-ir/adapter';
import { isIRId } from '@galacean/animation-ir/validator';
import { createId } from '../src/common/id';

interface LegacyTestPrecompAsset { id?: string; refId?: string }

export type TestIRLayerOverrides = Omit<Partial<IRLayerBase>, 'time'> & {
  type: IRLayerType;
  time?: import('@galacean/animation-ir').IRLayer['time'];
  content?: IRImageContent | IRPrecompContent | IRShapeContent | IRSolidContent | IRTextContent;
  imageUrl?: string;
  imageAssetId?: string;
  asset?: LegacyTestPrecompAsset;
};

const imageAssetById = new Map<string, IRScene['assets'][number]>();

export function migrateTestLayerAsset(
  layerId: string,
  type: IRLayerType,
  imageUrl: string | undefined,
  imageAssetId: string | undefined,
  asset: LegacyTestPrecompAsset | undefined,
): Pick<TestIRLayerOverrides, 'content'> {
  if (type === 'precomp') {
    return { content: { compositionId: createId(), clipToBounds: false } };
  }
  if (type !== 'image' || imageUrl == null || imageUrl === '') {
    return {};
  }
  const sourceId = imageAssetId ?? `${layerId}:${imageUrl}`;
  const assetId = isIRId(sourceId) ? sourceId : createId();

  imageAssetById.set(assetId, {
    id: assetId,
    type: 'image',
    source: createIRResourceSource(resolveIRResourceUrl(imageUrl, 'https://example.com/')),
  });

  return { content: { assetId } };
}

export function createTestIRScene(
  composition: IRComposition,
  providedAssets: IRScene['assets'] = [],
): IRScene {
  for (const asset of providedAssets) {
    imageAssetById.set(asset.id, asset);
  }

  const referencedAssetIds = new Set(
    composition.layers.flatMap(layer => {
      if (layer.type === 'image') {
        return [layer.content.assetId];
      }
      if (layer.type === 'text') {
        if (!imageAssetById.has(layer.content.fontAssetId)) {
          imageAssetById.set(layer.content.fontAssetId, {
            id: layer.content.fontAssetId,
            type: 'font',
            family: 'sans-serif',
            style: 'normal',
            weight: 400,
            source: { kind: 'system' },
          });
        }

        return [layer.content.fontAssetId];
      }
      if (layer.type === 'shape') {
        return (layer.content?.shapes ?? []).flatMap(shape =>
          [...shape.fills, ...shape.strokes.map(stroke => stroke.paint)]
            .flatMap(paint => paint.type === 'texture' ? [paint.assetId] : []),
        );
      }

      return [];
    }),
  );
  const assets = [...referencedAssetIds].flatMap(assetId => {
    const asset = imageAssetById.get(assetId);

    return asset == null ? [] : [asset];
  });

  const scene = createIRScene(composition, assets);
  const referencedCompositionIds = new Set(
    composition.layers.flatMap(layer => layer.type === 'precomp' ? [layer.content.compositionId] : []),
  );

  for (const compositionId of referencedCompositionIds) {
    if (compositionId === composition.id) {
      continue;
    }
    scene.compositions.push({
      id: compositionId,
      name: compositionId,
      width: composition.width,
      height: composition.height,
      frameRate: composition.frameRate,
      inPoint: 0,
      outPoint: composition.outPoint - composition.inPoint,
      endBehavior: composition.endBehavior,
      layers: [],
    });
  }

  return scene;
}

export function rememberTestIRSceneAssets(scene: IRScene): void {
  for (const asset of scene.assets) {
    imageAssetById.set(asset.id, asset);
  }
}

import type {
  LottieAsset, LottieImageAsset, LottieJSON, LottieLayer, LottiePrecompAsset,
  LottieToIRResult,
} from './common/conversion-types';
import {
  ANIMATION_IR_SCHEMA_VERSION, IREndBehavior, type IRComposition,
  type IRLayer,
} from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { createId } from './common/id';
import { convertLottieImageAssets } from './converter/convert-lottie-image-assets';
import { convertLottieTransform } from './converter/convert-lottie-transform';
import { convertLottieLayer } from './converter/convert-lottie-layer';
import { buildLottieFontAssetRegistry } from './converter/convert-lottie-text';
import { parseLottieLayerStack } from './parser/parse-lottie-layer-stack';

interface AssembleLottieIRSceneOptions {
  resolveResourceUrl?: (url: string) => string;
}

function buildIRCompositionFromIRLayers(
  layers: IRLayer[],
  options: {
    id: string;
    name?: string;
    width: number;
    height: number;
    frameRate: number;
    inPoint: number;
    outPoint: number;
  },
): IRComposition {
  return {
    id: options.id,
    ...(options.name != null && { name: options.name }),
    width: options.width,
    height: options.height,
    frameRate: options.frameRate,
    inPoint: options.inPoint,
    outPoint: options.outPoint,
    endBehavior: IREndBehavior.Loop,
    layers,
  };
}

/**
 * Assembles a Lottie animation into one root Composition plus one Composition per precomposition asset.
 *
 * Layer references are resolved before conversion, while image and font resources are collected into the shared Scene
 * asset registry. Unsupported or approximated source features are returned as diagnostics.
 */
export function assembleLottieIRScene(
  json: LottieJSON,
  options?: AssembleLottieIRSceneOptions,
): LottieToIRResult {
  const frameRate = Number(json['fr']);
  const width = Math.round(Number(json['w']));
  const height = Math.round(Number(json['h']));
  const name = typeof json['nm'] === 'string' ? json['nm'] : undefined;
  const ip = json['ip'];
  const op = json['op'];
  const assets = json['assets'] ?? [];
  const layers = json['layers'];

  const diagnostics: ConversionDiagnostic[] = [];
  const fonts = json.fonts?.list ?? [];
  const rootCompositionId = createId();
  const precompAssets = assets.filter(isPrecompAsset);
  const assetById = new Map(
    assets
      .filter(asset => typeof asset.id === 'string' && asset.id !== '')
      .map(asset => [asset.id, asset]),
  );
  const compositionIdByAssetId = new Map<string, string>();
  const referencedDimensionsByAssetId = collectReferencedPrecompDimensions(layers, precompAssets);
  const fontSourceLayers = [
    ...layers.toReversed(),
    ...precompAssets.flatMap(asset => asset.layers.toReversed()),
  ];
  const fontRegistry = buildLottieFontAssetRegistry(fontSourceLayers, fonts, options?.resolveResourceUrl);

  for (const asset of precompAssets) {
    compositionIdByAssetId.set(String(asset.id), createId());
  }

  // Layer parsing resolves graph references before individual layers are lowered to IR.
  const convertCompositionLayers = (
    compositionLayers: LottieLayer[],
    compositionInPoint: number,
    compositionOutPoint: number,
  ): IRLayer[] => {
    const parsed = parseLottieLayerStack({
      layers: compositionLayers,
      assetById,
      fonts,
      inPoint: compositionInPoint,
      outPoint: compositionOutPoint,
    });
    const convertedLayers: IRLayer[] = [];

    diagnostics.push(...parsed.diagnostics);
    for (const context of parsed.contexts) {
      const refId = 'refId' in context.sourceLayer ? context.sourceLayer.refId : undefined;
      const precompCompositionId = refId != null ? compositionIdByAssetId.get(String(refId)) : undefined;
      let parentLayerId = context.parentLayerId;

      // Private null layers retain ancestor transforms independently of visible
      // content lifetimes and preserve source-order multiplication for duplicate indices.
      for (const parent of context.parentTransformLayers?.toReversed() ?? []) {
        const transform = convertLottieTransform(parent);
        const id = createId();

        delete transform.opacity;
        convertedLayers.push({
          id,
          type: 'null',
          time: { inFrame: compositionInPoint, outFrame: compositionOutPoint },
          visible: true,
          transform,
          ...(parentLayerId != null && { parentId: parentLayerId }),
        });
        parentLayerId = id;
      }
      const converted = convertLottieLayer({
        layer: context.sourceLayer,
        asset: context.asset,
        id: context.layerId,
        parentLayerId,
        matte: context.matte,
        compositionRange: { inPoint: compositionInPoint, outPoint: compositionOutPoint },
        precompCompositionId,
        fontAssetIdByName: fontRegistry.assetIdByFontName,
        fonts,
        chars: json.chars,
      });

      diagnostics.push(...converted.diagnostics);
      convertedLayers.push(converted.layer);
    }

    return convertedLayers;
  };

  const rootLayers = convertCompositionLayers(layers, ip, op);
  const compositions: IRComposition[] = [
    buildIRCompositionFromIRLayers(rootLayers, {
      id: rootCompositionId,
      name,
      width,
      height,
      frameRate,
      inPoint: ip,
      outPoint: op,
    }),
  ];

  for (const asset of precompAssets) {
    const assetLayers = asset.layers;
    const compositionId = compositionIdByAssetId.get(String(asset.id));

    if (compositionId == null) {
      continue;
    }
    const inPoint = 0;
    const outPoint = resolvePrecompOutPoint(assetLayers, ip, op);
    const referencedDimensions = referencedDimensionsByAssetId.get(String(asset.id));
    const compositionWidth = resolvePositiveDimension(asset.w, referencedDimensions?.width ?? width);
    const compositionHeight = resolvePositiveDimension(asset.h, referencedDimensions?.height ?? height);
    const childLayers = convertCompositionLayers(
      assetLayers,
      inPoint,
      outPoint,
    );

    compositions.push(buildIRCompositionFromIRLayers(childLayers, {
      id: compositionId,
      name: String(asset.id),
      width: compositionWidth,
      height: compositionHeight,
      frameRate,
      inPoint,
      outPoint,
    }));
  }

  const scene: LottieToIRResult['scene'] = {
    format: 'animation-ir',
    schemaVersion: ANIMATION_IR_SCHEMA_VERSION,
    entryCompositionId: rootCompositionId,
    compositions,
    assets: [
      ...convertLottieImageAssets(
        collectReferencedImageAssets(layers, precompAssets, assetById),
        options?.resolveResourceUrl,
      ),
      ...fontRegistry.assets,
    ],
  };

  return {
    scene,
    diagnostics,
  };
}

function resolvePositiveDimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Collects the first usable instance dimensions for precomposition assets that omit their own canvas size. */
function collectReferencedPrecompDimensions(
  rootLayers: LottieLayer[],
  precompAssets: LottiePrecompAsset[],
): Map<string, { width: number; height: number }> {
  const dimensionsByAssetId = new Map<string, { width: number; height: number }>();
  const allCompositionLayers = [rootLayers, ...precompAssets.map(asset => asset.layers)];

  for (const compositionLayers of allCompositionLayers) {
    for (const layer of compositionLayers) {
      if (layer.ty !== 0 || layer.refId == null || dimensionsByAssetId.has(String(layer.refId))) {
        continue;
      }
      const width = resolvePositiveDimension(layer.w, 0);
      const height = resolvePositiveDimension(layer.h, 0);

      if (width > 0 && height > 0) {
        dimensionsByAssetId.set(String(layer.refId), { width, height });
      }
    }
  }

  return dimensionsByAssetId;
}

function isPrecompAsset(asset: LottieAsset): asset is LottiePrecompAsset {
  return 'layers' in asset && Array.isArray(asset.layers);
}

function collectReferencedImageAssets(
  rootLayers: LottieLayer[],
  precompAssets: LottiePrecompAsset[],
  assetById: ReadonlyMap<string, LottieAsset>,
): LottieImageAsset[] {
  const imageAssetIds = new Set<string>();

  for (const layers of [rootLayers, ...precompAssets.map(asset => asset.layers)]) {
    for (const layer of layers) {
      if (layer.ty === 2 && layer.refId !== '') {
        imageAssetIds.add(layer.refId);
      }
    }
  }

  return Array.from(imageAssetIds).flatMap(assetId => {
    const asset = assetById.get(assetId);

    return asset != null && 'p' in asset && typeof asset.p === 'string' && asset.p !== ''
      ? [asset as LottieImageAsset]
      : [];
  });
}

/** Derives an asset timeline because Lottie precomposition assets do not declare their own `ip` and `op`. */
function resolvePrecompOutPoint(layers: LottieLayer[], fallbackIn: number, fallbackOut: number): number {
  const outPoints = layers.map(layer => layer.op).filter(value => Number.isFinite(value));
  const fallbackDuration = fallbackOut - fallbackIn;
  const outPoint = outPoints.length > 0 ? Math.max(...outPoints) : fallbackDuration;

  return outPoint > 0 ? outPoint : Math.max(1, fallbackDuration);
}

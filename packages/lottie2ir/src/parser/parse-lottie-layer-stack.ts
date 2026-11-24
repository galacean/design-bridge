import { IRMatteMode, type IRLayerMatte } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type {
  LottieAsset, LottieFont, LottieImageAsset, LottieLayer,
  LottiePrecompAsset, LottieVisualLayer,
} from '../common/conversion-types';
import { createLottieDiagnostic } from '../common/conversion-diagnostic';
import { createId } from '../common/id';
import { normalizeSeparatedPosition, toFiniteNumber } from './parse-lottie-property';
import { parseLottieTextDocument } from './parse-lottie-text-document';

/** Source layer with the IR identity and graph references resolved for conversion. */
interface ParsedLottieLayerContext {
  sourceLayer: LottieVisualLayer;
  asset?: LottieImageAsset | LottiePrecompAsset;
  layerId: string;
  parentLayerId?: string;
  parentTransformLayers?: LottieVisualLayer[];
  matte?: IRLayerMatte;
}

interface ParseLottieLayerStackOptions {
  layers: LottieLayer[];
  assetById: ReadonlyMap<string, LottieAsset>;
  fonts: LottieFont[];
  inPoint: number;
  outPoint: number;
}

interface ParseLottieLayerStackResult {
  contexts: ParsedLottieLayerContext[];
  diagnostics: ConversionDiagnostic[];
}

function recordInvalidStretchRatio(layer: LottieVisualLayer, diagnostics: ConversionDiagnostic[]): void {
  const rawStretchRatio = (layer as unknown as Record<string, unknown>)['sr'];

  if (rawStretchRatio == null) {
    return;
  }
  if (typeof rawStretchRatio === 'number' && Number.isFinite(rawStretchRatio) && rawStretchRatio > 0) {
    return;
  }

  diagnostics.push(createLottieDiagnostic({
    code: 'invalid-stretch-ratio',
    message: `Layer '${layer['nm']}' has an invalid time stretch sr (${String(rawStretchRatio)}); using 1 instead.`,
    layerInd: layer['ind'],
  }));
}

function isSupportedVisualLayer(layer: LottieLayer): layer is LottieVisualLayer {
  return [0, 1, 2, 3, 4, 5].includes(layer.ty);
}

function isPrecompAsset(asset: LottieAsset | undefined): asset is LottiePrecompAsset {
  return asset != null && 'layers' in asset && Array.isArray(asset.layers);
}

function isImageAsset(asset: LottieAsset | undefined): asset is LottieImageAsset {
  return asset != null && 'p' in asset && typeof asset.p === 'string' && asset.p !== '';
}

function resolveLayerMattes(
  layers: LottieLayer[],
  contextByLayerIndex: ReadonlyMap<number, ParsedLottieLayerContext>,
  diagnostics: ConversionDiagnostic[],
): void {
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex];
    const layerRecord = layer as unknown as Record<string, unknown>;
    const matteType = layerRecord['tt'];

    if (matteType == null || matteType === 0) {
      continue;
    }
    const targetContext = typeof layer['ind'] === 'number' ? contextByLayerIndex.get(layer['ind']) : undefined;
    const explicitSourceInd = layerRecord['tp'];
    const defaultSourceLayer = layerIndex > 0 ? layers[layerIndex - 1] : undefined;
    const sourceInd = typeof explicitSourceInd === 'number' ? explicitSourceInd : defaultSourceLayer?.['ind'];
    const sourceContext = typeof sourceInd === 'number' ? contextByLayerIndex.get(sourceInd) : undefined;
    const mode = matteType === 1 || matteType === 2
      ? IRMatteMode.Alpha
      : matteType === 3 || matteType === 4
        ? IRMatteMode.Luminance
        : undefined;

    if (targetContext == null || sourceContext == null || mode == null) {
      diagnostics.push(createLottieDiagnostic({
        code: 'unsupported-track-matte',
        message:
          `Layer '${layer['nm']}' has a track matte (tt=${String(matteType)}) without a resolvable source layer.`,
        layerInd: layer['ind'],
      }));
      continue;
    }

    targetContext.matte = {
      sourceLayerId: sourceContext.layerId,
      mode,
      ...((matteType === 2 || matteType === 4) && { inverted: true }),
    };
  }
}

/**
 * Resolves one Composition's asset, parent, and matte references before layer conversion.
 *
 * Supported layers are returned in IR back-to-front painter order after every reference is known.
 */
export function parseLottieLayerStack({
  layers,
  assetById,
  fonts,
  inPoint,
  outPoint,
}: ParseLottieLayerStackOptions): ParseLottieLayerStackResult {
  const contexts: ParsedLottieLayerContext[] = [];
  const contextByLayerIndex = new Map<number, ParsedLottieLayerContext>();
  const diagnostics: ConversionDiagnostic[] = [];
  const appendParsedLayer = (context: Omit<ParsedLottieLayerContext, 'layerId'>): void => {
    const parsedContext: ParsedLottieLayerContext = {
      ...context,
      layerId: createId(),
    };

    contexts.push(parsedContext);
    if (typeof context.sourceLayer['ind'] === 'number') {
      contextByLayerIndex.set(context.sourceLayer['ind'], parsedContext);
    }
  };

  // Lottie lists topmost layers first; IR uses back-to-front painter order.
  for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex--) {
    const layer = layers[layerIndex];
    const layerRecord = layer as unknown as Record<string, unknown>;
    const refId = layerRecord['refId'];
    const asset = refId != null ? assetById.get(String(refId)) : undefined;

    if (!isSupportedVisualLayer(layer)) {
      diagnostics.push(createLottieDiagnostic({
        code: 'unsupported-layer-type',
        message: `Layer '${layer['nm']}' has an unsupported type (${String(layer['ty'])}).`,
        layerInd: layer['ind'],
      }));

      continue;
    }

    const normalizedPosition = normalizeSeparatedPosition(layer);
    const layerForTransform = normalizedPosition.layer;

    if (normalizedPosition.approximated) {
      diagnostics.push(createLottieDiagnostic({
        code: 'separated-position-fallback',
        message:
          `Layer '${layer['nm']}' has separated position axes with incompatible animation timing; ` +
          'the axes were merged by sampling their combined keyframe times.',
        layerInd: layer['ind'],
      }));
    }

    const precompAsset = layer.ty === 0 && isPrecompAsset(asset) ? asset : undefined;
    const imageAsset = layer.ty === 2 && isImageAsset(asset) ? asset : undefined;

    if (layer.ty === 0) {
      if (precompAsset != null) {
        recordInvalidStretchRatio(layer, diagnostics);
        appendParsedLayer({
          sourceLayer: layerForTransform,
          asset: precompAsset,
        });
      } else {
        diagnostics.push(createLottieDiagnostic({
          code: 'unsupported-layer-type',
          message:
            `Precomposition layer '${layer['nm']}' references missing asset '${String(layer['refId'])}'; ` +
            'the layer was ignored.',
          layerInd: layer['ind'],
          featureKinds: ['missing-precomp-asset'],
        }));
      }
    } else if (layer.ty === 2) {
      if (imageAsset != null) {
        appendParsedLayer({
          sourceLayer: layerForTransform,
          asset: imageAsset,
        });
      } else {
        diagnostics.push(createLottieDiagnostic({
          code: 'missing-image-asset',
          message:
            `Image layer '${layer['nm']}' references missing asset '${String(layer['refId'])}'; ` +
            'the layer was ignored.',
          layerInd: layer['ind'],
          featureKinds: ['missing-image-asset'],
        }));
      }
    } else if (layer.ty === 5) {
      const textDocument = parseLottieTextDocument(layerForTransform);

      if (textDocument != null) {
        const fontName = textDocument['f'];
        const fontInfo = typeof fontName === 'string' ? fonts.find(item => item.fName === fontName) : undefined;

        if (fontInfo === undefined) {
          diagnostics.push(createLottieDiagnostic({
            code: 'missing-font',
            message: `Text layer '${layer['nm']}' references font '${String(fontName)}' which is not in the fonts list`,
            layerInd: layer['ind'],
          }));
        }
        appendParsedLayer({
          sourceLayer: layerForTransform,
        });
      } else {
        diagnostics.push(createLottieDiagnostic({
          code: 'missing-text-data',
          message: `Text layer '${layer['nm']}' has no text data`,
          layerInd: layer['ind'],
        }));
      }
    } else {
      appendParsedLayer({
        sourceLayer: layerForTransform,
      });
    }
  }

  const contextsByIndex = new Map<number, ParsedLottieLayerContext[]>();

  for (const context of contexts.toReversed()) {
    const index = context.sourceLayer.ind;

    if (typeof index === 'number') {
      const matches = contextsByIndex.get(index) ?? [];

      matches.push(context);
      contextsByIndex.set(index, matches);
    }
  }
  for (const [index, matches] of contextsByIndex) {
    if (matches.length > 1) {
      diagnostics.push(createLottieDiagnostic({
        code: 'duplicate-layer-index',
        message: `Layer index ${index} is duplicated; parent transforms follow lottie-web's source-order hierarchy.`,
        layerInd: index,
      }));
    }
  }

  const collectParents = (
    context: ParsedLottieLayerContext,
    ancestors: Set<ParsedLottieLayerContext>,
  ): { parents: ParsedLottieLayerContext[]; ambiguous: boolean } => {
    if (ancestors.has(context)) {
      throw new TypeError('Cyclic Lottie parent references cannot be converted.');
    }
    const parentIndex = context.sourceLayer.parent;
    const matches = typeof parentIndex === 'number' ? contextsByIndex.get(parentIndex) ?? [] : [];
    const parents: ParsedLottieLayerContext[] = [];
    let ambiguous = matches.length > 1;

    ancestors.add(context);
    for (const parent of matches) {
      const inherited = collectParents(parent, ancestors);

      parents.push(parent, ...inherited.parents);
      ambiguous ||= inherited.ambiguous;
    }
    ancestors.delete(context);

    return { parents, ambiguous };
  };

  for (const context of contexts) {
    const { parents, ambiguous } = collectParents(context, new Set());
    const childIn = Math.max(inPoint, toFiniteNumber(context.sourceLayer.ip, 0));
    const childOut = Math.min(outPoint, toFiniteNumber(context.sourceLayer.op, 0));
    // Lottie evaluates ancestor transforms even when their own content is inactive.
    const needsIndependentLifetime = childOut > childIn && parents.some(parent =>
      childIn < toFiniteNumber(parent.sourceLayer.ip, 0) || childOut > toFiniteNumber(parent.sourceLayer.op, 0));

    if (ambiguous || needsIndependentLifetime) {
      context.parentTransformLayers = parents.map(parent => parent.sourceLayer);
    } else {
      context.parentLayerId = parents[0]?.layerId;
    }
  }

  resolveLayerMattes(layers, contextByLayerIndex, diagnostics);

  return { contexts, diagnostics };
}

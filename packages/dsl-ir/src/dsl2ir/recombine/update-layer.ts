import type {
  IRFontAsset, IRImageAsset, IRLayer, IRScene, IRTextContent,
} from '@galacean/animation-ir';
import { getIRResourceSourceUrl } from '@galacean/animation-ir/adapter';
import type { Layer, TextProperties } from '../../dsl/schema';
import { createId, hexToIRColor, isHexEqual, isScalarEqual } from '../../common/utils';
import { TRANSFORM_FALLBACK, translateDSLPosition, withPositionZ } from '../../common/transform';
import { estimateTextBounds, getIRTextOrigin, getTextLayoutOrigin } from '../../common/text-layout';
import {
  convertDSLPropertyToIRNumber,
  convertDSLPropertyToIRRotation,
  convertDSLPropertyToIRVec3,
  convertDSLPropertyToStaticIRVec3,
} from '../convert-property';
import { ensureSystemFontAsset, resolveAssetSource, resolveTextStyle } from '../content-conversion';
import {
  collectTextPropertyChanges,
  isAnimatedPropertyEqual,
  isAssetEqual,
  readTextProperties,
} from './compare-properties';
import { updateIRParticle } from './update-particle';
import type { DSLToIRChangeReporter, DSLToIRWarningReporter } from '../types';

export function updateIRLayer(
  irLayer: IRLayer,
  irScene: IRScene,
  editedLayer: Layer,
  baselineLayer: Layer,
  dslPath: string,
  frameRate: number,
  reportWarning: DSLToIRWarningReporter,
  reportChange: DSLToIRChangeReporter,
  applySupportedEdits = true,
): void {
  if (editedLayer.type !== baselineLayer.type) {
    reportUnsupportedLayerEdit(
      reportWarning,
      'LAYER_TYPE_CHANGE_IGNORED',
      `type change on layer '${editedLayer.id}' ('${baselineLayer.type}' -> '${editedLayer.type}') is ignored.`,
      editedLayer.id,
      `${dslPath}.type`,
    );
  }

  const description = editedLayer.description;

  if ((typeof description?.self === 'string' && description.self !== baselineLayer.description?.self) ||
    (typeof description?.composite === 'string' && description.composite !== baselineLayer.description?.composite)) {
    reportUnsupportedLayerEdit(
      reportWarning,
      'LAYER_DESCRIPTION_CHANGE_IGNORED',
      `description change on layer '${editedLayer.id}' is not represented in Animation IR and is ignored.`,
      editedLayer.id,
      `${dslPath}.description`,
    );
  }

  if ((editedLayer.parent ?? null) !== (baselineLayer.parent ?? null)) {
    reportUnsupportedLayerEdit(
      reportWarning,
      'PARENT_CHANGE_IGNORED',
      `parent change on layer '${editedLayer.id}' ` +
        `('${baselineLayer.parent}' -> '${editedLayer.parent}') is ignored in this mode.`,
      editedLayer.id,
      `${dslPath}.parent`,
    );
  }

  if (!applySupportedEdits) {
    return;
  }

  if (typeof editedLayer.name === 'string' && editedLayer.name !== baselineLayer.name) {
    const previousName = irLayer.name;

    irLayer.name = editedLayer.name;
    reportChange({
      kind: 'layer',
      op: 'set',
      field: 'name',
      layerId: editedLayer.id,
      oldValue: previousName,
      newValue: editedLayer.name,
    });
  }

  const textOrigin = getIRTextOrigin(irLayer);

  updateIRTransform(irLayer, irScene, editedLayer, baselineLayer, frameRate, reportChange);
  updateIRTiming(irLayer, editedLayer, baselineLayer, frameRate, reportChange);
  updateIRText(irLayer, irScene, editedLayer, baselineLayer, reportChange);
  updateIRParticle(irLayer, editedLayer, baselineLayer, frameRate, reportChange);
  updateIRLocalBounds(irLayer, editedLayer, textOrigin, reportChange);
  updateIRAsset(irLayer, irScene, editedLayer, baselineLayer, reportChange);
}

function updateIRLocalBounds(
  irLayer: IRLayer,
  editedLayer: Layer,
  textOrigin: [number, number],
  reportChange: DSLToIRChangeReporter,
): void {
  if (irLayer.type !== 'text' && irLayer.type !== 'image' && irLayer.type !== 'particle') {
    return;
  }
  const previousBounds = irLayer.localBounds;
  const estimatedBounds = irLayer.type === 'text' ? estimateTextBounds(irLayer.content) : undefined;
  const fallbackWidth = previousBounds?.width ?? estimatedBounds?.width ?? editedLayer.width;
  const fallbackHeight = previousBounds?.height ?? estimatedBounds?.height ?? editedLayer.height;
  const updatedBounds = {
    x: previousBounds?.x ?? 0,
    y: previousBounds?.y ?? 0,
    width: Number.isFinite(editedLayer.width) && editedLayer.width > 0 ? editedLayer.width : fallbackWidth,
    height: Number.isFinite(editedLayer.height) && editedLayer.height > 0 ? editedLayer.height : fallbackHeight,
  };

  if (irLayer.type === 'text') {
    const [offsetX, offsetY] = getTextLayoutOrigin(irLayer.content, updatedBounds.width);

    updatedBounds.x = textOrigin[0] - offsetX;
    updatedBounds.y = textOrigin[1] - offsetY;
  }

  if (
    previousBounds != null &&
    isScalarEqual(updatedBounds.x, previousBounds.x) &&
    isScalarEqual(updatedBounds.y, previousBounds.y) &&
    isScalarEqual(updatedBounds.width, previousBounds.width) &&
    isScalarEqual(updatedBounds.height, previousBounds.height)
  ) {
    return;
  }

  irLayer.localBounds = updatedBounds;
  reportChange({
    kind: 'layer',
    op: 'set',
    field: 'localBounds',
    layerId: editedLayer.id,
    oldValue: previousBounds,
    newValue: updatedBounds,
  });
}

function reportUnsupportedLayerEdit(
  reportWarning: DSLToIRWarningReporter,
  code: string,
  message: string,
  layerId: string,
  path: string,
): void {
  const formattedMessage = `[dsl-ir:preserved-data] ${message}`;

  reportWarning({ code, message: formattedMessage, path, layerId });
}

function updateIRTransform(
  irLayer: IRLayer,
  irScene: IRScene,
  editedLayer: Layer,
  baselineLayer: Layer,
  frameRate: number,
  reportChange: DSLToIRChangeReporter,
): void {
  // Create the transform lazily so no-op updates preserve the baseline shape.
  const ensureTransform = (): NonNullable<IRLayer['transform']> => (irLayer.transform ??= {});

  if (!isAnimatedPropertyEqual(withPositionZ(editedLayer.position, 0), withPositionZ(baselineLayer.position, 0))) {
    const sourcePosition = irLayer.transform?.position;
    const parent = irLayer.parentId == null ? undefined : irScene.compositions
      .find(composition => composition.layers.includes(irLayer))?.layers.find(layer => layer.id === irLayer.parentId);
    const editedPosition = parent?.type === 'text'
      ? translateDSLPosition(editedLayer.position, getIRTextOrigin(parent)) : editedLayer.position;
    const position = convertDSLPropertyToIRVec3(
      withPositionZ(editedPosition, 0),
      frameRate,
      TRANSFORM_FALLBACK.position,
      true,
    );

    if (sourcePosition?.type === 'static') {
      if (position.type === 'static') {
        position.value[2] = sourcePosition.value[2];
      } else {
        for (const keyframe of position.keyframes) {
          keyframe.value[2] = sourcePosition.value[2];
          if (keyframe.endValue != null) {
            keyframe.endValue[2] = sourcePosition.value[2];
          }
        }
      }
    }
    if (sourcePosition?.type === 'keyframed') {
      const depths = sourcePosition.keyframes.flatMap(keyframe =>
        [keyframe.value[2], (keyframe.endValue ?? keyframe.value)[2]],
      );
      const constantDepth = depths.every(depth => depth === depths[0]);

      if (position.type === 'static' && constantDepth) {
        position.value[2] = depths[0] ?? 0;
      } else if (position.type === 'keyframed') {
        for (const keyframe of position.keyframes) {
          const sourceIndex = sourcePosition.keyframes.findIndex(candidate => candidate.frame === keyframe.frame);
          const source = sourcePosition.keyframes[sourceIndex];

          if (source == null && !constantDepth) {
            throw new Error('[dsl-ir] Position timing edits on layers with animated source depth are unsupported.');
          }
          keyframe.value[2] = source?.value[2] ?? depths[0] ?? 0;
          if (keyframe.endValue != null) {
            const sourceEnd = source?.hold === true
              ? source.value
              : (source?.endValue ?? sourcePosition.keyframes[sourceIndex + 1]?.value ?? source?.value);

            keyframe.endValue[2] = sourceEnd?.[2] ?? depths[0] ?? 0;
          }
        }
      } else {
        throw new Error('[dsl-ir] Replacing animated source depth with static position is unsupported.');
      }
    }
    ensureTransform().position = position;
    reportChange({
      kind: 'transform',
      op: 'set',
      field: 'position',
      layerId: editedLayer.id,
      oldValue: baselineLayer.position,
      newValue: editedLayer.position,
    });
  }

  if (editedLayer.rotation !== undefined && !isAnimatedPropertyEqual(editedLayer.rotation, baselineLayer.rotation)) {
    const transform = ensureTransform();

    transform.rotation = convertDSLPropertyToIRRotation(editedLayer.rotation, frameRate, TRANSFORM_FALLBACK.rotation);
    reportChange({
      kind: 'transform',
      op: 'set',
      field: 'rotation',
      layerId: editedLayer.id,
      oldValue: baselineLayer.rotation,
      newValue: editedLayer.rotation,
    });
  }

  if (editedLayer.scale !== undefined && !isAnimatedPropertyEqual(editedLayer.scale, baselineLayer.scale)) {
    ensureTransform().scale = convertDSLPropertyToIRVec3(editedLayer.scale, frameRate, TRANSFORM_FALLBACK.scale, false);
    reportChange({
      kind: 'transform',
      op: 'set',
      field: 'scale',
      layerId: editedLayer.id,
      oldValue: baselineLayer.scale,
      newValue: editedLayer.scale,
    });
  }

  if (editedLayer.anchor !== undefined && !isAnimatedPropertyEqual(editedLayer.anchor, baselineLayer.anchor)) {
    const anchor = convertDSLPropertyToStaticIRVec3(editedLayer.anchor, TRANSFORM_FALLBACK.anchor);
    const [originX, originY] = getIRTextOrigin(irLayer);

    anchor.value[0] += originX;
    anchor.value[1] += originY;
    ensureTransform().anchor = anchor;
    reportChange({
      kind: 'transform',
      op: 'set',
      field: 'anchor',
      layerId: editedLayer.id,
      oldValue: baselineLayer.anchor,
      newValue: editedLayer.anchor,
    });
  }

  if (editedLayer.opacity !== undefined && !isAnimatedPropertyEqual(editedLayer.opacity, baselineLayer.opacity)) {
    ensureTransform().opacity = convertDSLPropertyToIRNumber(
      editedLayer.opacity,
      frameRate,
      TRANSFORM_FALLBACK.opacity,
    );
    reportChange({
      kind: 'transform',
      op: 'set',
      field: 'opacity',
      layerId: editedLayer.id,
      oldValue: baselineLayer.opacity,
      newValue: editedLayer.opacity,
    });
  }
}

function updateIRTiming(
  irLayer: IRLayer,
  editedLayer: Layer,
  baselineLayer: Layer,
  frameRate: number,
  reportChange: DSLToIRChangeReporter,
): void {
  if (editedLayer.time_range === undefined || (
    baselineLayer.time_range !== undefined &&
    isScalarEqual(editedLayer.time_range[0], baselineLayer.time_range[0]) &&
    isScalarEqual(editedLayer.time_range[1], baselineLayer.time_range[1])
  )) {
    return;
  }

  const previousTime = irLayer.time;

  irLayer.time = {
    ...irLayer.time,
    inFrame: editedLayer.time_range[0] * frameRate,
    outFrame: editedLayer.time_range[1] * frameRate,
  };
  reportChange({
    kind: 'timing',
    op: 'set',
    field: 'time_range',
    layerId: editedLayer.id,
    oldValue: previousTime,
    newValue: editedLayer.time_range,
  });
}

function updateIRText(
  irLayer: IRLayer,
  irScene: IRScene,
  editedLayer: Layer,
  baselineLayer: Layer,
  reportChange: DSLToIRChangeReporter,
): void {
  const editedText = readTextProperties(editedLayer);
  const baselineText = readTextProperties(baselineLayer);

  if (irLayer.type !== 'text' || editedText == null) {
    return;
  }

  const normalizedEditedText = resolveTextStyle(editedText, baselineText);
  const textChanges = baselineText != null ? collectTextPropertyChanges(baselineText, normalizedEditedText) : [];

  if (baselineText != null && textChanges.length === 0) {
    return;
  }

  const previousText = irLayer.content;
  const currentFontAsset = resolveFontAsset(irScene, irLayer.content.fontAssetId);
  const fontAssetId = baselineText == null || textChanges.some(change => change.field === 'font')
    ? ensureSystemFontAsset(
      irScene.assets,
      normalizedEditedText.font ?? currentFontAsset.family,
      currentFontAsset.style,
      currentFontAsset.weight,
    )
    : irLayer.content.fontAssetId;

  irLayer.content = buildUpdatedTextData(irLayer.content, normalizedEditedText, fontAssetId);
  if (baselineText != null && isHexEqual(normalizedEditedText.color, baselineText.color)) {
    irLayer.content.color = previousText.color;
  }
  if (baselineText == null) {
    reportChange({
      kind: 'text',
      op: 'set',
      field: 'text',
      layerId: editedLayer.id,
      oldValue: previousText,
      newValue: normalizedEditedText,
    });
  } else {
    for (const { field, oldValue, newValue } of textChanges) {
      reportChange({
        kind: 'text',
        op: 'set',
        field: `text.${field}`,
        layerId: editedLayer.id,
        oldValue,
        newValue,
      });
    }
  }
}

function buildUpdatedTextData(currentText: IRTextContent, editedText: TextProperties, fontAssetId: string): IRTextContent {
  return {
    text: editedText.content,
    fontAssetId,
    fontSize: editedText.size,
    color: hexToIRColor(editedText.color),
    textAlign: editedText.align ?? currentText.textAlign,
    letterSpacing: editedText.letter_spacing ?? currentText.letterSpacing,
    lineHeight: editedText.line_height ?? currentText.lineHeight,
  };
}

function resolveFontAsset(irScene: IRScene, fontAssetId: string): IRFontAsset {
  const fontAsset = irScene.assets.find(
    (asset): asset is IRFontAsset => asset.type === 'font' && asset.id === fontAssetId,
  );

  if (fontAsset == null) {
    throw new TypeError(`[dsl-ir] Text references a missing Font Asset: ${fontAssetId}`);
  }

  return fontAsset;
}

function updateIRAsset(
  irLayer: IRLayer,
  irScene: IRScene,
  editedLayer: Layer,
  baselineLayer: Layer,
  reportChange: DSLToIRChangeReporter,
): void {
  if (irLayer.type !== 'image' || editedLayer.asset == null) {
    return;
  }

  let imageAsset = irScene.assets.find(
    (asset): asset is IRImageAsset => asset.type === 'image' && asset.id === irLayer.content.assetId,
  );

  if (imageAsset == null) {
    return;
  }

  if (baselineLayer.asset != null && isAssetEqual(editedLayer.asset, baselineLayer.asset)) {
    return;
  }

  const editedSource = resolveAssetSource(editedLayer.asset);
  const editedUrl = getIRResourceSourceUrl(editedSource);
  const baselineUrl = baselineLayer.asset == null
    ? undefined
    : getIRResourceSourceUrl(resolveAssetSource(baselineLayer.asset));

  if (editedUrl !== baselineUrl) {
    const previousUrl = getIRResourceSourceUrl(imageAsset.source);

    if (countImageAssetReferences(irScene, imageAsset.id) > 1) {
      const clonedAssetId = createAvailableRecombineAssetId(irScene);

      imageAsset = { ...imageAsset, id: clonedAssetId };
      irScene.assets.push(imageAsset);
      irLayer.content.assetId = clonedAssetId;
    }
    imageAsset.source = editedSource;
    reportChange({
      kind: 'asset',
      op: 'set',
      field: 'asset.url',
      layerId: editedLayer.id,
      oldValue: previousUrl,
      newValue: editedUrl,
    });
  }
}

function countImageAssetReferences(irScene: IRScene, assetId: string): number {
  let count = 0;

  for (const composition of irScene.compositions) {
    for (const layer of composition.layers) {
      if (layer.type === 'image' && layer.content.assetId === assetId) {
        count++;
      } else if (layer.type === 'shape') {
        for (const shape of layer.content.shapes) {
          const paints = [...shape.fills, ...shape.strokes.map(stroke => stroke.paint)];

          count += paints.filter(paint => paint.type === 'texture' && paint.assetId === assetId).length;
        }
      }
    }
  }

  return count;
}

function createAvailableRecombineAssetId(irScene: IRScene): string {
  const existingAssetIdSet = new Set(irScene.assets.map(asset => asset.id));

  while (true) {
    const candidate = createId();

    if (!existingAssetIdSet.has(candidate)) {
      return candidate;
    }
  }
}

import type { AnimatedProperty, AnimationCurve, Asset, Layer, TextProperties } from '../../dsl/schema';
import { isHexEqual, isNumberArrayEqual } from '../../common/utils';
import { resolveDSLEasing } from '../convert-property';

const TEXT_PROPERTY_FIELDS = ['content', 'font', 'size', 'color', 'align', 'line_height', 'letter_spacing'] as const;

interface TextPropertyChange {
  field: (typeof TEXT_PROPERTY_FIELDS)[number];
  oldValue: TextProperties[(typeof TEXT_PROPERTY_FIELDS)[number]];
  newValue: TextProperties[(typeof TEXT_PROPERTY_FIELDS)[number]];
}

/**
 * Structural, epsilon-tolerant equality between two editable-DSL properties.
 *
 * Used for preserved-data change detection so writeback replaces only edited
 * fields in the IR snapshot.
 */
export function isAnimatedPropertyEqual(
  leftProperty: AnimatedProperty | undefined,
  rightProperty: AnimatedProperty | undefined,
): boolean {
  if (leftProperty === undefined || rightProperty === undefined) {
    return leftProperty === rightProperty;
  }
  if (leftProperty.a !== rightProperty.a) {
    return false;
  }

  if (!leftProperty.a) {
    return (
      !rightProperty.a && isNumberArrayEqual(toNumberArray(leftProperty.value), toNumberArray(rightProperty.value))
    );
  }

  if (!rightProperty.a) {
    return false;
  }

  if (leftProperty.animation.length !== rightProperty.animation.length) {
    return false;
  }

  return leftProperty.animation.every((curve, curveIndex) =>
    isAnimationCurveEqual(curve, rightProperty.animation[curveIndex]),
  );
}

export function collectTextPropertyChanges(
  baselineText: TextProperties,
  editedText: TextProperties,
): TextPropertyChange[] {
  const changes: TextPropertyChange[] = [];

  for (const field of TEXT_PROPERTY_FIELDS) {
    const oldValue = baselineText[field];
    const newValue = editedText[field];
    const isEqual =
      field === 'color' ? isHexEqual(oldValue as string, newValue as string) : Object.is(oldValue, newValue);

    if (!isEqual) {
      changes.push({ field, oldValue, newValue });
    }
  }

  return changes;
}

export function readTextProperties(layer: Layer): TextProperties | undefined {
  return layer.type === 'text' && layer.text != null ? layer.text : undefined;
}

export function isAssetEqual(leftAsset: Asset, rightAsset: Asset): boolean {
  if (leftAsset.source !== rightAsset.source) {
    return false;
  }
  if (leftAsset.source === 'user' && rightAsset.source === 'user') {
    return leftAsset.url === rightAsset.url;
  }

  return (
    leftAsset.source === 'llm_svg' &&
    rightAsset.source === 'llm_svg' &&
    leftAsset.url === rightAsset.url &&
    leftAsset.svg === rightAsset.svg &&
    leftAsset.prompt === rightAsset.prompt
  );
}

function isAnimationCurveEqual(leftCurve: AnimationCurve, rightCurve: AnimationCurve): boolean {
  return (
    isNumberArrayEqual(leftCurve.t, rightCurve.t) &&
    isNumberArrayEqual(leftCurve.start, rightCurve.start) &&
    isNumberArrayEqual(leftCurve.end, rightCurve.end) &&
    isNumberArrayEqual(resolveDSLEasing(leftCurve.easing), resolveDSLEasing(rightCurve.easing)) &&
    isNumberArrayEqual(toNumberArray(leftCurve.out), toNumberArray(rightCurve.out)) &&
    isNumberArrayEqual(toNumberArray(leftCurve.in), toNumberArray(rightCurve.in))
  );
}

function toNumberArray(value: number | number[] | undefined): number[] {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

import { spec } from '@galacean/effects';
import type { ConversionIssue, EffectsScene } from '../types';
import { asRecord } from '../utils';

function isColorArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 4 && value.every(item => typeof item === 'number');
}

function hasDataPathId(value: unknown): value is { id: string } {
  const record = asRecord(value);

  return record !== undefined && typeof record.id === 'string' && record.id.length > 0;
}

export function validateRuntimeReadiness(scene: EffectsScene): ConversionIssue[] {
  const issues: ConversionIssue[] = [];

  const images = Array.isArray(scene.images) ? scene.images : [];
  const textures = Array.isArray(scene.textures) ? scene.textures : [];

  const imageIds = new Set(
    images.map(image => asRecord(image)?.id).filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  const textureIds = new Set(
    textures
      .map(texture => asRecord(texture)?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  for (const texture of textures) {
    const textureRecord = asRecord(texture);

    if (!textureRecord) {
      issues.push({
        type: 'warning',
        message: 'Found non-object texture entry in scene.textures.',
      });
      continue;
    }

    const source = textureRecord.source;

    if (hasDataPathId(source) && !imageIds.has(source.id)) {
      issues.push({
        type: 'error',
        message: `Texture ${String(textureRecord.id ?? '(unknown)')} references missing image id: ${source.id}.`,
      });
    }
  }

  for (const component of scene.components) {
    const dataType = component.dataType;

    if (dataType === spec.DataType.SpriteComponent) {
      const sprite = component as spec.SpriteComponentData;
      const renderer = asRecord(sprite.renderer);
      const options = asRecord(sprite.options);

      if (!renderer) {
        issues.push({
          type: 'error',
          message: `SpriteComponent ${component.id} is missing renderer.`,
        });
        continue;
      }

      const texturePath = renderer.texture;

      if (texturePath !== undefined && hasDataPathId(texturePath) && !textureIds.has(texturePath.id)) {
        issues.push({
          type: 'error',
          message: `SpriteComponent ${component.id} references missing texture id: ${texturePath.id}.`,
        });
      }

      const startColor = options?.startColor;

      if (startColor !== undefined && !isColorArray(startColor)) {
        issues.push({
          type: 'warning',
          message: `SpriteComponent ${component.id} has invalid options.startColor (expected RGBA[4]).`,
        });
      }

      const strokeColor = options?.strokeColor;

      if (strokeColor !== undefined && !isColorArray(strokeColor)) {
        issues.push({
          type: 'warning',
          message: `SpriteComponent ${component.id} has invalid options.strokeColor (expected RGBA[4]).`,
        });
      }

      const strokeWidth = options?.strokeWidth;

      if (strokeWidth !== undefined && (typeof strokeWidth !== 'number' || strokeWidth < 0)) {
        issues.push({
          type: 'warning',
          message: `SpriteComponent ${component.id} has invalid options.strokeWidth (expected non-negative number).`,
        });
      }
    }

    if (dataType === spec.DataType.TextComponent) {
      const text = component as spec.TextComponentData;
      const options = asRecord(text.options);

      if (!options) {
        issues.push({
          type: 'error',
          message: `TextComponent ${component.id} is missing options.`,
        });
        continue;
      }

      if (typeof options.text !== 'string') {
        issues.push({
          type: 'error',
          message: `TextComponent ${component.id} has invalid options.text (expected string).`,
        });
      }

      if (typeof options.fontSize !== 'number') {
        issues.push({
          type: 'warning',
          message: `TextComponent ${component.id} has invalid options.fontSize (expected number).`,
        });
      }

      if (options.textColor !== undefined && !isColorArray(options.textColor)) {
        issues.push({
          type: 'warning',
          message: `TextComponent ${component.id} has invalid options.textColor (expected RGBA[4]).`,
        });
      }
    }
  }

  const activeComposition = scene.compositions.find(composition => composition.id === scene.compositionId);

  if (!activeComposition) {
    issues.push({
      type: 'error',
      message: `Active composition ${scene.compositionId} not found while running runtime smoke checks.`,
    });
  } else if (!activeComposition.children || activeComposition.children.length === 0) {
    issues.push({
      type: 'warning',
      message: `Active composition ${scene.compositionId} has no children; runtime may render an empty frame.`,
    });
  }

  return issues;
}

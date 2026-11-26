import type { IRAsset } from '../schema/asset.js';
import { IRAssetSourceKind, IRAssetType } from '../schema/asset.js';
import { IRLayerType } from '../schema/layer.js';
import { IRPaintType } from '../schema/shape.js';
import { ValidationContext } from './context.js';
import { isIRId, isRecord } from './value-validation.js';

const MIME_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
/** The final character subsets keep all unused bits before padding at zero. */
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/;

function validateAssetMimeType(ctx: ValidationContext, value: unknown, path: string): void {
  if (typeof value !== 'string' || value.trim() !== value || !MIME_TYPE_PATTERN.test(value)) {
    ctx.error('IR_ASSET_MIME_TYPE_INVALID', path, 'must be a valid MIME type');
  }
}

function isValidResourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) {
    return false;
  }

  try {
    return new URL(value).protocol !== 'data:';
  } catch {
    return false;
  }
}

function validateAssetSource(ctx: ValidationContext, value: unknown, path: string, allowSystem: boolean): void {
  if (!isRecord(value)) {
    const sourceKinds = allowSystem ? 'URL, embedded, or system Font' : 'URL or embedded resource';

    ctx.error('IR_ASSET_SOURCE_INVALID', path, `must be a ${sourceKinds} source`);

    return;
  }

  if (value['kind'] === IRAssetSourceKind.Url) {
    if (!isValidResourceUrl(value['url'])) {
      ctx.error('IR_ASSET_SOURCE_INVALID', `${path}.url`, 'must be an absolute non-data URL');
    }

    return;
  }

  if (value['kind'] === IRAssetSourceKind.Embedded) {
    validateAssetMimeType(ctx, value['mimeType'], `${path}.mimeType`);
    if (
      typeof value['data'] !== 'string' ||
      value['data'] === '' ||
      !CANONICAL_BASE64_PATTERN.test(value['data'])
    ) {
      ctx.error(
        'IR_ASSET_DATA_INVALID',
        `${path}.data`,
        'must be canonical Base64 without a data URL prefix or whitespace',
      );
    }

    return;
  }

  if (value['kind'] === IRAssetSourceKind.System) {
    if (!allowSystem) {
      ctx.error('IR_ASSET_SOURCE_INVALID', `${path}.kind`, "'system' is only valid for Font assets");
    }

    return;
  }

  const expectedKinds = allowSystem ? "'url', 'embedded', or 'system'" : "'url' or 'embedded'";

  ctx.error('IR_ASSET_SOURCE_INVALID', `${path}.kind`, `must be ${expectedKinds}`);
}

function validateImageAsset(ctx: ValidationContext, value: Record<string, unknown>, path: string): void {
  validateAssetSource(ctx, value['source'], `${path}.source`, false);
}

function validateFontAsset(ctx: ValidationContext, value: Record<string, unknown>, path: string): void {
  if (typeof value['family'] !== 'string' || value['family'].trim() === '') {
    ctx.error('IR_ASSET_FONT_FAMILY_INVALID', `${path}.family`, 'must be a non-empty string');
  }
  if (value['style'] !== 'normal' && value['style'] !== 'italic' && value['style'] !== 'oblique') {
    ctx.error('IR_ASSET_FONT_STYLE_INVALID', `${path}.style`, "must be 'normal', 'italic', or 'oblique'");
  }
  if (
    typeof value['weight'] !== 'number' ||
    !Number.isInteger(value['weight']) ||
    value['weight'] < 1 ||
    value['weight'] > 1000
  ) {
    ctx.error('IR_ASSET_FONT_WEIGHT_INVALID', `${path}.weight`, 'must be an integer from 1 to 1000');
  }

  validateAssetSource(ctx, value['source'], `${path}.source`, true);
  if (isRecord(value['source']) && value['source']['kind'] === IRAssetSourceKind.System) {
    ctx.warning(
      'IR_ASSET_FONT_SYSTEM_PORTABILITY',
      `${path}.source`,
      'System Font availability and metrics may differ between consumer environments',
    );
  }
}

function validateAsset(ctx: ValidationContext, value: unknown, index: number): string | undefined {
  const path = `assets[${index}]`;

  if (!isRecord(value)) {
    ctx.error('IR_ASSET_INVALID', path, 'must be an object');

    return undefined;
  }

  const assetId = isIRId(value['id']) ? value['id'] : undefined;

  if (assetId === undefined) {
    ctx.error('IR_ASSET_ID_INVALID', `${path}.id`, 'must be a valid Asset ID');
  }

  if (value['type'] === IRAssetType.Image) {
    validateImageAsset(ctx, value, path);
  } else if (value['type'] === IRAssetType.Font) {
    validateFontAsset(ctx, value, path);
  } else {
    ctx.error('IR_ASSET_TYPE_INVALID', `${path}.type`, "must be 'image' or 'font'");
  }

  return assetId;
}

interface ValidatedAssetReference {
  path: string;
  type: IRAsset['type'];
}

export function validateAssets(ctx: ValidationContext, value: unknown): Map<string, ValidatedAssetReference> {
  const assetById = new Map<string, ValidatedAssetReference>();

  if (!Array.isArray(value)) {
    ctx.error('IR_SCENE_ASSETS_INVALID', 'assets', 'must be an array');

    return assetById;
  }

  for (const [index, asset] of value.entries()) {
    const assetId = validateAsset(ctx, asset, index);

    if (assetId === undefined || !isRecord(asset)) {
      continue;
    }

    const assetPath = `assets[${index}]`;
    const existing = assetById.get(assetId);

    if (existing != null) {
      ctx.error('IR_ASSET_ID_DUPLICATE', `${assetPath}.id`, `duplicates ${existing.path}.id`);
      continue;
    }
    if (asset['type'] === IRAssetType.Image || asset['type'] === IRAssetType.Font) {
      assetById.set(assetId, { path: assetPath, type: asset['type'] });
    }
  }

  return assetById;
}

function validateImageAssetReference(
  ctx: ValidationContext,
  content: Record<string, unknown>,
  contentPath: string,
  assetById: ReadonlyMap<string, ValidatedAssetReference>,
): void {
  const assetId = content['assetId'];

  if (!isIRId(assetId)) {
    return;
  }
  const path = `${contentPath}.assetId`;
  const target = assetById.get(assetId);

  if (target == null) {
    ctx.error('IR_LAYER_IMAGE_ASSET_MISSING', path, `does not resolve to an Asset: ${assetId}`);
  } else if (target.type !== IRAssetType.Image) {
    ctx.error(
      'IR_LAYER_IMAGE_ASSET_TYPE_INVALID',
      path,
      `must resolve to an Image Asset, but ${target.path} is '${target.type}'`,
    );
  }
}

function validateTextFontAssetReference(
  ctx: ValidationContext,
  content: Record<string, unknown>,
  contentPath: string,
  assetById: ReadonlyMap<string, ValidatedAssetReference>,
): void {
  const fontAssetId = content['fontAssetId'];

  if (!isIRId(fontAssetId)) {
    return;
  }
  const path = `${contentPath}.fontAssetId`;
  const target = assetById.get(fontAssetId);

  if (target == null) {
    ctx.error('IR_TEXT_FONT_ASSET_MISSING', path, `does not resolve to an Asset: ${fontAssetId}`);
  } else if (target.type !== IRAssetType.Font) {
    ctx.error(
      'IR_TEXT_FONT_ASSET_TYPE_INVALID',
      path,
      `must resolve to a Font Asset, but ${target.path} is '${target.type}'`,
    );
  }
}

function validateShapeTextureAssetReferences(
  ctx: ValidationContext,
  content: Record<string, unknown>,
  contentPath: string,
  assetById: ReadonlyMap<string, ValidatedAssetReference>,
): void {
  const shapes = content['shapes'];

  if (!Array.isArray(shapes)) {
    return;
  }
  for (const [shapeIndex, shape] of shapes.entries()) {
    if (!isRecord(shape)) {
      continue;
    }
    const shapePath = `${contentPath}.shapes[${shapeIndex}]`;
    const fills = shape['fills'];

    if (Array.isArray(fills)) {
      for (const [paintIndex, paint] of fills.entries()) {
        validateShapeTexturePaintReference(ctx, paint, `${shapePath}.fills[${paintIndex}]`, assetById);
      }
    }
    const strokes = shape['strokes'];

    if (Array.isArray(strokes)) {
      for (const [strokeIndex, stroke] of strokes.entries()) {
        if (isRecord(stroke)) {
          validateShapeTexturePaintReference(
            ctx,
            stroke['paint'],
            `${shapePath}.strokes[${strokeIndex}].paint`,
            assetById,
          );
        }
      }
    }
  }
}

function validateShapeTexturePaintReference(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  assetById: ReadonlyMap<string, ValidatedAssetReference>,
): void {
  if (!isRecord(value) || value['type'] !== IRPaintType.Texture || !isIRId(value['assetId'])) {
    return;
  }
  const assetId = value['assetId'];
  const target = assetById.get(assetId);

  if (target == null) {
    ctx.error('IR_SHAPE_TEXTURE_ASSET_MISSING', `${path}.assetId`, `does not resolve to an Asset: ${assetId}`);
  } else if (target.type !== IRAssetType.Image) {
    ctx.error(
      'IR_SHAPE_TEXTURE_ASSET_TYPE_INVALID',
      `${path}.assetId`,
      `must resolve to an Image Asset, but ${target.path} is '${target.type}'`,
    );
  }
}

export function validateAssetReferences(
  ctx: ValidationContext,
  compositions: unknown[],
  assetById: ReturnType<typeof validateAssets>,
): void {
  // Keep diagnostic groups stable: assertIRScene exposes the first error to callers.
  const fontContext = new ValidationContext();
  const textureContext = new ValidationContext();

  for (const [compositionIndex, composition] of compositions.entries()) {
    if (!isRecord(composition) || !Array.isArray(composition['layers'])) {
      continue;
    }
    for (const [layerIndex, layer] of composition['layers'].entries()) {
      if (!isRecord(layer) || !isRecord(layer['content'])) {
        continue;
      }
      const content = layer['content'];
      const contentPath = `compositions[${compositionIndex}].layers[${layerIndex}].content`;

      switch (layer['type']) {
        case IRLayerType.Image:
          validateImageAssetReference(ctx, content, contentPath, assetById);

          break;
        case IRLayerType.Text:
          validateTextFontAssetReference(fontContext, content, contentPath, assetById);
          if (Array.isArray(content['styleRanges'])) {
            for (const [rangeIndex, range] of content['styleRanges'].entries()) {
              if (isRecord(range)) {
                validateTextFontAssetReference(
                  fontContext, range, `${contentPath}.styleRanges[${rangeIndex}]`, assetById,
                );
              }
            }
          }

          break;
        case IRLayerType.Shape:
          validateShapeTextureAssetReferences(textureContext, content, contentPath, assetById);

          break;
      }
    }
  }
  for (const group of [fontContext, textureContext]) {
    for (const issue of group.errors) {
      ctx.errors.push(issue);
    }
    for (const warning of group.warnings) {
      ctx.warnings.push(warning);
    }
  }
}

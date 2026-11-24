import type { IRScene } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { convertIRToGE } from '@galacean/ge-ir';
import { SVG2IR_WARNING_CODES, type ConvertOptions, type ConvertResult, type SVG2IRWarning } from '../../common/types';
import type { SVGFontDefinition, SVGPreservedData, SVGPreservedPaintAnimation } from '../../svg-preserved-data';
import type { SVGToGEOptions, SVGToGEResult } from './types';
import { rewriteTextComponentsToRichText } from './post-process/rewrite-text-components';
import {
  applyShapeAnimationBasePaths, expandIRHoldTransitions, expandPaintAnimationHoldKeyframes,
} from './pre-process';
import { applyFonts } from './post-process/apply-fonts';
import { restoreGradientUV } from './post-process/restore-gradient-uv';
import { applyShapePaintAnimation } from './post-process/apply-shape-paint-animation';
import { applyShapeGeometryAnimations } from './post-process/apply-shape-geometry-animation';

/** 从已解析的 IR 和 SVG 保留数据生成 GE 场景。 */
export function assembleSVGGE(
  parsed: ConvertResult,
  options?: SVGToGEOptions,
  preservedData?: SVGPreservedData,
): SVGToGEResult {
  const { ir } = parsed;
  const warnings = [...parsed.warnings];
  const { fonts } = options ?? {};
  const irForGE = expandIRHoldTransitions(ir);

  if (preservedData?.shapeAnimationsByLayerId != null) {
    applyShapeAnimationBasePaths(irForGE, preservedData.shapeAnimationsByLayerId);
  }
  const exportResult = convertIRToGE(irForGE);
  const data = exportResult.scene;

  emitGEExportDiagnostics(exportResult.diagnostics, warnings, options?.onWarning);

  if (preservedData != null) {
    const paintAnimationsByLayerId = clonePaintAnimationMap(preservedData.paintAnimationsByLayerId);

    expandPaintAnimationHoldKeyframes(paintAnimationsByLayerId);

    applyShapePaintAnimation(data, ir, paintAnimationsByLayerId);
    applyShapeGeometryAnimations(data, ir, preservedData.shapeAnimationsByLayerId);
    restoreGradientUV(data, ir.compositions[0].width, ir.compositions[0].height);
    rewriteTextComponentsToRichText(data, {
      textDataByLayerId: preservedData.textDataByLayerId,
      itemLayerIds: exportResult.itemLayerIds,
    });
  }

  applyFonts(data, fonts);
  emitMissingFontWarnings(ir, fonts, warnings, options?.onWarning);

  return { data, warnings };
}

function clonePaintAnimationMap(
  source: ReadonlyMap<string, readonly SVGPreservedPaintAnimation[]>,
): Map<string, SVGPreservedPaintAnimation[]> {
  return new Map(
    Array.from(
      source,
      ([layerIndex, animations]) => [layerIndex, structuredClone(animations) as SVGPreservedPaintAnimation[]] as const,
    ),
  );
}

function emitGEExportDiagnostics(
  diagnostics: readonly ConversionDiagnostic[],
  warnings: SVG2IRWarning[],
  onWarning: ConvertOptions['onWarning'],
): void {
  for (const diagnostic of diagnostics) {
    const warning: SVG2IRWarning = {
      code: SVG2IR_WARNING_CODES.GE_EXPORT_DIAGNOSTIC,
      message: `[${diagnostic.code}] ${diagnostic.message}`,
      elementSelector: diagnostic.sourceId ?? diagnostic.path,
    };

    warnings.push(warning);
    onWarning?.(warning);
  }
}

function emitMissingFontWarnings(
  ir: IRScene,
  fonts: readonly SVGFontDefinition[] | undefined,
  warnings: SVG2IRWarning[],
  onWarning: ConvertOptions['onWarning'],
): void {
  const genericFamilies = new Set([
    'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-sans-serif', 'ui-serif', 'ui-monospace', 'Arial', 'Helvetica',
  ]);
  const suppliedFamilies = new Set((fonts ?? []).map(font => cleanFontName(font.fontFamily)));
  const fontAssetById = new Map(
    ir.assets.filter(asset => asset.type === 'font').map(asset => [asset.id, asset] as const),
  );
  const reported = new Set<string>();

  for (const composition of ir.compositions) {
    for (const layer of composition.layers) {
      if (layer.type !== 'text') { continue; }
      const family = cleanFontName(fontAssetById.get(layer.content.fontAssetId)?.family ?? '');

      if (family !== '' && !suppliedFamilies.has(family) && !genericFamilies.has(family) && !reported.has(family)) {
        reported.add(family);
        const warning: SVG2IRWarning = {
          code: SVG2IR_WARNING_CODES.TEXT_FONT_NOT_SUPPLIED,
          message: `文字使用的字体 "${family}" 未在 SVG→GE 适配器中提供字体文件，Effects Runtime 可能使用 fallback 字体。`,
        };

        warnings.push(warning);
        onWarning?.(warning);
      }
    }
  }
}

function cleanFontName(raw: string): string {
  let value = raw.trim();

  for (let index = 0; index < 2; index++) {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    value = value.split(',')[0].trim();
  }

  return value;
}

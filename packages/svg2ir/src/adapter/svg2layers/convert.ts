import { SVG2IR_WARNING_CODES, type SVGSource, type SVG2IRWarning } from '../../common/types';
import type { SVGPreservedData } from '../../svg-preserved-data';
import { parseSVGToIRWithPreservedData } from '../../svg2ir/convert';
import { assembleSVGLayers } from './assemble';
import type { SVGStaticLayerConversionContext } from './assemble';
import { collectLayerWarning } from './converter/diagnostics/collect-warnings';
import { buildBakedLayers } from './baking/build-baked-layers';
import { inlineImageResources } from './post-process/inline-image-resources';
import { stripLayerAnimation } from './strip-layer-animation';
import type { SVGToLayersOptions, SVGToLayersResult } from './types';

export async function convertSVGToLayers(
  source: SVGSource,
  options: SVGToLayersOptions = {},
  preservedData?: SVGPreservedData,
): Promise<SVGToLayersResult> {
  const { loadImage, rasterScale = 2, ...conversionOptions } = options;
  const layerSources = new Map<string, string>();
  const warningSources = new Map<SVG2IRWarning, string>();
  const collected: Required<SVGPreservedData> = {
    textDataByLayerId: new Map(), paintAnimationsByLayerId: new Map(), shapeAnimationsByLayerId: new Map(),
  };
  const stripped = stripLayerAnimation(source);
  const staticSource = stripped.source;

  // Preserve original layer IDs while gathering the source identities required by baking and assembly.
  const parsed = parseSVGToIRWithPreservedData(staticSource, { ...conversionOptions, strict: false, onWarning: undefined }, {
    ...collected, layerSourceCollector: layerSources, warningSourceCollector: warningSources,
  });
  const context: SVGStaticLayerConversionContext = {
    source: staticSource, ir: parsed.ir, warnings: parsed.warnings, preservedData: preservedData ?? collected,
    layerSources, warningSources,
  };

  if (stripped.removed > 0) {
    collectLayerWarning(context.warnings, { ...conversionOptions, strict: false, onWarning: undefined },
      SVG2IR_WARNING_CODES.LAYERS_ANIMATION_STRIPPED,
      `${stripped.removed} animated element(s) were removed; static layers output does not sample animation.`);
  }

  const composition = context.ir.compositions[0];
  const baking = await buildBakedLayers(context.source, [composition.width, composition.height], conversionOptions,
    rasterScale);
  const assembled = assembleSVGLayers({ context, options: conversionOptions, baking });

  return { ...assembled, data: await inlineImageResources(assembled.data, loadImage) };
}

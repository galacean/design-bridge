import type { JSONScene } from '@galacean/effects-specification';
import type { ConvertOptions, SVG2IRWarning } from '../../common/types';
import type { SVGFontDefinition } from '../../svg-preserved-data';

export interface SVGToGEOptions extends ConvertOptions {
  fonts?: readonly SVGFontDefinition[]; // IR → GE 后注入的 Runtime 字体定义。
}

export interface SVGToGEResult {
  /** 由 convertIRToGE 生成并可选经过 SVG 专属适配的 Effects JSONScene。 */
  data: JSONScene;
  warnings: SVG2IRWarning[];
}

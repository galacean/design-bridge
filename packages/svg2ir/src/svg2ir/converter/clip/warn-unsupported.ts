import type { Element as SVGElementNode } from '@svgdotjs/svg.js';
import { SVG2IR_WARNING_CODES, type SVG2IRWarning } from '../../../common/types';
import { collectWarning, describeElement } from '../diagnostics/collect-warnings';

/**
 * 报告 IR mask 无法保留的 SVG clip/mask 语义。
 * 几何路径本身仍然支持；warning 用于显式说明坐标或 alpha 语义的降级。
 */
export function warnUnsupportedClipMaskFeatures (
  el: SVGElementNode,
  tag: 'clippath' | 'mask',
  emit: (warning: SVG2IRWarning) => void,
  strict: boolean,
): void {
  const node = (el as unknown as { node?: globalThis.Element | null }).node;
  const selector = describeElement(el);
  const read = (name: string): string => node?.getAttribute?.(name)?.trim() ?? '';
  const warn = (code: SVG2IRWarning['code'], message: string): void => {
    collectWarning(emit, code, message, selector, strict);
  };

  if (tag === 'clippath') {
    const units = read('clipPathUnits').toLowerCase();

    if (units !== '' && units !== 'userspaceonuse') {
      warn(
        SVG2IR_WARNING_CODES.CLIP_PATH_UNITS_DROPPED,
        'clipPathUnits 仅支持 userSpaceOnUse，objectBoundingBox 坐标未映射。',
      );
    }
  } else {
    const contentUnits = read('maskContentUnits').toLowerCase();

    if (contentUnits !== '' && contentUnits !== 'userspaceonuse') {
      warn(
        SVG2IR_WARNING_CODES.MASK_CONTENT_UNITS_DROPPED,
        'maskContentUnits 仅支持 userSpaceOnUse，objectBoundingBox 坐标未映射。',
      );
    }

    if (['maskUnits', 'x', 'y', 'width', 'height'].some(attribute => read(attribute) !== '')) {
      warn(
        SVG2IR_WARNING_CODES.MASK_REGION_DROPPED,
        'maskUnits 及 mask 的 x/y/width/height region 未映射，IR mask 只使用内容几何。',
      );
    }

    if (read('mask-type') !== '') {
      warn(
        SVG2IR_WARNING_CODES.MASK_TYPE_DROPPED,
        'mask-type 的 alpha/luminance 语义未映射，IR 只保留路径 mask 几何。',
      );
    }
  }

  const ruleNodes = node == null ? [] : [node, ...Array.from(node.querySelectorAll('*'))];
  const hasUnsupportedRule = ruleNodes.some(candidate => (
    (candidate.getAttribute('clip-rule')?.trim() ?? '') !== ''
    || (candidate.getAttribute('fill-rule')?.trim() ?? '') !== ''
  ));

  if (hasUnsupportedRule) {
    warn(
      SVG2IR_WARNING_CODES.CLIP_RULE_DROPPED,
      `${tag} 内显式 clip-rule/fill-rule 未映射，IR 只保留 mask 几何，不保留该规则。`,
    );
  }
}

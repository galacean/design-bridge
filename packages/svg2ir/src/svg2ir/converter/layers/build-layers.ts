import { buildElementTreePath } from '../../../parse-svg/build-element-tree-path';
import type { IRAsset, IRLayer } from '@galacean/animation-ir';
import type EditableSVG from '../../../parse-svg/svg-parser';
import { SVG2IR_WARNING_CODES } from '../../../common/types';
import { collectWarning, describeElement } from '../diagnostics/collect-warnings';
import { filterReplacesSource } from '../diagnostics/inspect-filter';
import { isMappedSMILAnimationElement } from '../smil/inspect-animation';
import { readUseTarget } from '../use/expand-use';
import {
  createSVGConversionSession,
  type SVGLayerBuildOptions,
  type SVGConversionSession,
} from './conversion-session';
import { SVG_UNSUPPORTED_ELEMENT_TAGS } from './element-categories';
import { createSVGElementConverterRegistry } from './registry';
import { isInInactiveSwitchBranch } from '../switch-branch';

export type { SVGLayerBuildOptions } from './conversion-session';

export function buildSVGLayers (
  es: EditableSVG,
  options: SVGLayerBuildOptions,
): { layers: IRLayer[]; assets: IRAsset[] } {
  let currentPath: string | undefined;
  const warningSourceCollector = options.warningSourceCollector;
  const session: SVGConversionSession = createSVGConversionSession(es, warningSourceCollector == null ? options : {
    ...options,
    emit: warning => {
      if (currentPath != null) { warningSourceCollector.set(warning, currentPath); }
      options.emit(warning);
    },
  });
  const converters = createSVGElementConverterRegistry(session);

  for (const element of session.all) {
    const tag = element.node?.tagName?.toLowerCase() ?? '';
    const selector = describeElement(element);

    if (warningSourceCollector != null) { currentPath = buildElementTreePath(element.node); }
    if (isInInactiveSwitchBranch(element)) { continue; }
    if (session.isDeclarationContext(element)) { continue; }
    if (tag === 'switch') { continue; }

    const useTargetIsText = tag === 'use' && session.idTextEls.has(readUseTarget(es, element) ?? '');
    const skipByFilterReplace = tag !== 'image'
      && !useTargetIsText
      && filterReplacesSource(es, element, session.rootEl);

    if (skipByFilterReplace) {
      collectWarning(
        session.emit,
        SVG2IR_WARNING_CODES.FILTER_DROPPED,
        `元素 <${tag}> 带 filter(投影/模糊/内阴影等),GE 无元素级 filter(仅文本 shadow),已跳过元素——该效果缺失产生预期视觉差异,属 GE 能力缺失(标 ge-capability;保留则会渲成 raw fill 盖背景)。`,
        selector,
        session.strict,
      );
      continue;
    }

    session.warnReferencedClipMaskFeatures(element);
    const converter = converters.get(tag);

    if (converter != null) {
      converter(element);
      continue;
    }
    if (SVG_UNSUPPORTED_ELEMENT_TAGS.has(tag) && !isMappedSMILAnimationElement(element, tag)) {
      collectWarning(
        session.emit,
        SVG2IR_WARNING_CODES.ELEMENT_DROPPED,
        `元素 <${tag}> 当前未映射到 GE,已跳过(use/filter/pattern 等待接入)。`,
        selector,
        session.strict,
      );
    }
  }

  return { layers: session.layers, assets: session.assets };
}

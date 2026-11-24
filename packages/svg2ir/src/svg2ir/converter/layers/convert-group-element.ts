import type { Element } from '@svgdotjs/svg.js';
import { IRLayerType, type IRLayer, type IRVec3 } from '@galacean/animation-ir';
import { SVG2IR_WARNING_CODES } from '../../../common/types';
import { buildGroupMaskForG } from '../clip/build-clip-mask';
import { collectWarning, describeElement } from '../diagnostics/collect-warnings';
import { warnUnsupportedAttributes } from '../diagnostics/warn-unsupported';
import { maskCoversFull } from '../clip/collect-geometry';
import type { GroupConversionContext } from './conversion-session';

export function convertGroupElement (element: Element, context: GroupConversionContext): void {
  warnUnsupportedAttributes(context.es, element, 'g', context.emit, context.strict, context.idEls);
  const groupClipPath = element.node?.getAttribute('clip-path')?.trim() ?? '';

  if (groupClipPath !== '' && groupClipPath !== 'none') {
    collectWarning(
      context.emit,
      SVG2IR_WARNING_CODES.GROUP_CLIP_PATH_DROPPED,
      '<g> 的组级 clip-path 未映射，当前只支持元素级 clip-path 与组级 mask。',
      describeElement(element),
      context.strict,
    );
  }
  const groupMask = buildGroupMaskForG(context.es, element, context.rootEl);

  if (groupMask != null && maskCoversFull(groupMask.path.points, context.width, context.height)) { return; }
  if (groupMask == null) { return; }

  const layerIndex = context.allocateLayerIndex();
  const nullLayer: IRLayer = {
    type: IRLayerType.Null,
    id: `${layerIndex}`,
    name: String(context.es.getAttr(element, 'id') ?? 'g_mask'),
    time: { inFrame: 0, outFrame: context.outFrame },
    visible: true,
    transform: {
      position: { type: 'static', value: [context.compCenterX, context.compCenterY, 0] as IRVec3 },
      scale: { type: 'static', value: [1, 1, 1] },
      rotation: { z: { type: 'static', value: 0 } },
      anchor: { type: 'static', value: [context.compCenterX, context.compCenterY, 0] as IRVec3 },
      opacity: { type: 'static', value: 1 },
    },
    masks: [groupMask],
  };

  context.appendLayer(nullLayer, element, false);
  context.groupMaskGNodeToIndex.set(element.node, layerIndex);
}

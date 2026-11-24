import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRShape } from '@galacean/animation-ir';
import { convertCircularAnnulusToEllipseStroke } from './convert-annulus';
import { parseCustomPath, parseEllipse, parseRect } from './parse-shape-primitives';

export function parseShapeElement (es: EditableSVG, el: Element, tag: string): IRShape | null {
  switch (tag) {
    case 'rect':
      return parseRect(es, el);
    case 'circle':
      return parseEllipse(es, el, true);
    case 'ellipse':
      return parseEllipse(es, el, false);
    case 'path': {
      const shape = parseCustomPath(es, el, 'path');

      return shape == null ? null : convertCircularAnnulusToEllipseStroke(es, el, shape) ?? shape;
    }
    case 'polygon':
      return parseCustomPath(es, el, 'polygon');
    case 'polyline':
      return parseCustomPath(es, el, 'polyline');
    case 'line':
      return parseCustomPath(es, el, 'line');
    default:
      return null;
  }
}

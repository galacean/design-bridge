import type EditableSVG from '../parse-svg/svg-parser';
import { readPresentationAttribute } from '../parse-svg/read-presentation-attribute';
import type { Element } from '@svgdotjs/svg.js';

const HORIZONTAL_LENGTH_ATTRIBUTES = new Set(['x', 'x1', 'x2', 'cx', 'width', 'rx']);
const VERTICAL_LENGTH_ATTRIBUTES = new Set(['y', 'y1', 'y2', 'cy', 'height', 'ry']);
const DIAGONAL_LENGTH_ATTRIBUTES = new Set(['r', 'stroke-width', 'stroke-dashoffset']);

/** 从 SVG 元素读取数值属性；支持 px、无单位数值和常见 viewport 百分比。 */
export function readSVGNumberAttribute (es: EditableSVG, el: Element, attribute: string, fallback?: number): number | undefined {
  const value = es.getAttr(el, attribute);

  if (value == null || value === '') { return fallback; }
  if (typeof value === 'number') { return Number.isFinite(value) ? value : fallback; }
  const raw = value.trim();
  const percentage = raw.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)%$/i);

  if (percentage != null) {
    const reference = getPercentageReference(el, attribute);

    return reference == null ? fallback : Number(percentage[1]) * reference / 100;
  }
  const concrete = raw.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(?:px)?$/i);

  if (concrete == null) { return fallback; }
  const parsed = Number(concrete[1]);

  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 从 SVG 元素读取字符串属性。 */
export function readSVGStringAttribute (es: EditableSVG, el: Element, attribute: string): string {
  const value = es.getAttr(el, attribute);

  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** display:none 或 visibility:hidden 的 SVG 元素不参与渲染。 */
export function isSVGElementVisible (es: EditableSVG, el: Element): boolean {
  if (readSVGStringAttribute(es, el, 'display').toLowerCase() === 'none') { return false; }

  return readSVGStringAttribute(es, el, 'visibility').toLowerCase() !== 'hidden';
}

/** 读取元素自身 opacity，不包含祖先组。 */
export function readSVGOwnOpacity(el: Element): number {
  const node = (el as unknown as { node?: globalThis.Element | null }).node;
  const raw = readPresentationAttribute(node, 'opacity');
  const value = raw == null || raw.trim() === '' ? 1 : Number(raw);

  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

/** 读取元素自身 opacity，并乘入所有祖先组 opacity。 */
export function readSVGElementOpacity(el: Element): number {
  let opacity = 1;
  let node = (el as unknown as { node?: globalThis.Element | null }).node;

  while (node != null) {
    const raw = readPresentationAttribute(node, 'opacity');

    if (raw != null && raw.trim() !== '') {
      const value = Number(raw);

      if (Number.isFinite(value)) {
        opacity *= Math.max(0, Math.min(1, value));
      }
    }
    if (node.tagName.toLowerCase() === 'svg') { break; }
    node = node.parentNode as globalThis.Element | null;
  }

  return Math.max(0, Math.min(1, opacity));
}

function getPercentageReference(el: Element, attribute: string): number | undefined {
  const viewport = readSVGViewport(el);

  if (viewport == null) { return undefined; }
  if (HORIZONTAL_LENGTH_ATTRIBUTES.has(attribute)) { return viewport.width; }
  if (VERTICAL_LENGTH_ATTRIBUTES.has(attribute)) { return viewport.height; }
  if (DIAGONAL_LENGTH_ATTRIBUTES.has(attribute)) {
    return Math.hypot(viewport.width, viewport.height) / Math.SQRT2;
  }

  return undefined;
}

function readSVGViewport(el: Element): { width: number; height: number } | undefined {
  const node = (el as unknown as { node?: globalThis.Element | null }).node;
  const root = node?.tagName.toLowerCase() === 'svg'
    ? node
    : (node as globalThis.SVGElement | null | undefined)?.ownerSVGElement;

  if (root == null) { return undefined; }
  const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const viewBoxWidth = viewBox.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : undefined;
  const viewBoxHeight = viewBox.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : undefined;
  const width = viewBoxWidth ?? parseConcreteLength(root.getAttribute('width'));
  const height = viewBoxHeight ?? parseConcreteLength(root.getAttribute('height'));

  return width != null && height != null ? { width, height } : undefined;
}

function parseConcreteLength(value: string | null): number | undefined {
  const match = value?.trim().match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(?:px)?$/i);
  const parsed = match == null ? NaN : Number(match[1]);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 将 SVG image 元素解析为 IR image layer 和 image asset。
 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import { type IRImageAsset, type IRImageLayer, type IRLocalBounds, type IRVec3 } from '@galacean/animation-ir';
import { isSVGElementVisible, readSVGElementOpacity, readSVGNumberAttribute } from '../../read-attributes';
import { createIRResourceSource, resolveIRResourceUrl } from '@galacean/animation-ir/adapter';
import { accumulateAncestors, decomposeMatrix, IDENTITY, multiply, parseTransform } from '../../matrix';

/** 读 <image> href:优先 href(SVG2),次 xlink:href。 */
function readImageHref (es: EditableSVG, el: Element): string | undefined {
  const sourceUrl = es.getAttr(el, 'data-svg2ir-source-url');

  if (typeof sourceUrl === 'string' && sourceUrl !== '') { return sourceUrl; }
  const href = es.getAttr(el, 'href');

  if (typeof href === 'string' && href !== '') { return href; }
  const xhref = es.getAttr(el, 'xlink:href');

  return typeof xhref === 'string' && xhref !== '' ? xhref : undefined;
}

/** 解析 image 图层和对应资源；图层标识由图层转换器补齐。 */
export function parseImageLayer (es: EditableSVG, el: Element, imageNaturalSizes?: ReadonlyMap<string, { width: number; height: number }>, resourceBaseUrl?: string): { layer: Omit<IRImageLayer, 'id' | 'name' | 'time'>; asset: IRImageAsset } | null {
  const url = readImageHref(es, el);

  if (url == null) {
    // 缺少 href 时返回 null。
    return null;
  }
  const x = readSVGNumberAttribute(es, el, 'x', 0) ?? 0;
  const y = readSVGNumberAttribute(es, el, 'y', 0) ?? 0;
  const width = readSVGNumberAttribute(es, el, 'width', 0) ?? 0;
  const height = readSVGNumberAttribute(es, el, 'height', 0) ?? 0;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const source = createIRResourceSource(resolveIRResourceUrl(url, resourceBaseUrl));
  const assetId = url;
  const asset: IRImageAsset = { id: assetId, type: 'image', source };
  // localBounds 使用 SVG <image> 的显示框尺寸，而不是 asset 的自然尺寸。
  const domNode = (el as unknown as { node?: { getAttribute?: (n: string) => string | null } }).node;
  const svgW = domNode?.getAttribute?.('width');
  const svgH = domNode?.getAttribute?.('height');
  const lbW = svgW != null && svgW !== '' ? Number(svgW) || width : width;
  const lbH = svgH != null && svgH !== '' ? Number(svgH) || height : height;
  // preserveAspectRatio 使用 meet 或 slice 时，根据自然尺寸计算等比显示区域。
  let lbWidth = lbW;
  let lbHeight = lbH;
  let anchorX = width / 2;
  let anchorY = height / 2;

  const meet = computeMeetFit(domNode, lbW, lbH, url, imageNaturalSizes);

  if (meet != null) {
    lbWidth = meet.width;
    lbHeight = meet.height;
    anchorX = meet.width / 2;
    anchorY = meet.height / 2;
  } else {
    const cover = computeSliceCoverFit(domNode, lbW, lbH, url, imageNaturalSizes);

    if (cover != null) {
      lbWidth = cover.width;
      lbHeight = cover.height;
      anchorX = cover.width / 2;
      anchorY = cover.height / 2;
    }
  }
  const localBounds: IRLocalBounds = { x: 0, y: 0, width: lbWidth, height: lbHeight };
  // anchor=图片中心(对齐 lottie AE 图片层 ks.a 习惯),position=中心坐标(SVG x/y 左上→中心)。
  const cx = x + width / 2;
  const cy = y + height / 2;
  // 合并元素及祖先变换，得到图层中心、缩放和旋转。
  const mAnc = accumulateAncestors(el);
  const selfAttr = (el as { node?: { getAttribute?: (n: string) => string | null } }).node?.getAttribute?.('transform') ?? '';
  const mSelf = selfAttr !== '' ? parseTransform(selfAttr) : IDENTITY;
  const m = multiply(mAnc, mSelf);
  const wx = m.a * cx + m.c * cy + m.e;
  const wy = m.b * cx + m.d * cy + m.f;
  const opacity = readSVGElementOpacity(el);
  const { sx, sy, rotation } = decomposeMatrix(m);

  const layer: Omit<IRImageLayer, 'id' | 'name' | 'time'> = {
    type: 'image',
    content: { assetId },
    localBounds,
    visible: isSVGElementVisible(es, el),
    transform: {
      position: { type: 'static', value: [wx, wy, 0] as IRVec3 },
      anchor: { type: 'static', value: [anchorX, anchorY, 0] as IRVec3 },
      scale: { type: 'static', value: [sx, sy, 1] },
      rotation: { z: { type: 'static', value: rotation } },
      opacity: { type: 'static', value: opacity },
    },
  };

  return { layer, asset };
}

function readEmbeddedImageSize (url: string): { width: number; height: number } | undefined {
  const match = url.match(/^data:image\/(png|gif|jpe?g);base64,([^,]+)$/i);

  if (match == null || typeof globalThis.atob !== 'function') { return undefined; }
  let binary: string;

  try {
    binary = globalThis.atob(match[2]);
  } catch {
    return undefined;
  }

  const byte = (index: number): number => binary.charCodeAt(index) & 0xff;
  const format = match[1].toLowerCase();

  if (format === 'png' && binary.length >= 24
    && byte(0) === 0x89 && byte(1) === 0x50 && byte(2) === 0x4e && byte(3) === 0x47) {
    const width = byte(16) * 0x1000000 + byte(17) * 0x10000 + byte(18) * 0x100 + byte(19);
    const height = byte(20) * 0x1000000 + byte(21) * 0x10000 + byte(22) * 0x100 + byte(23);

    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (format === 'gif' && binary.length >= 10) {
    const width = byte(6) | byte(7) << 8;
    const height = byte(8) | byte(9) << 8;

    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if ((format !== 'jpg' && format !== 'jpeg') || binary.length < 4 || byte(0) !== 0xff || byte(1) !== 0xd8) {
    return undefined;
  }

  let offset = 2;

  while (offset + 3 < binary.length) {
    if (byte(offset) !== 0xff) {
      offset++;
      continue;
    }
    while (offset < binary.length && byte(offset) === 0xff) { offset++; }
    const marker = byte(offset++);

    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { continue; }
    if (offset + 1 >= binary.length) { break; }
    const segmentLength = byte(offset) * 0x100 + byte(offset + 1);

    if (segmentLength < 2 || offset + segmentLength > binary.length) { break; }
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame && segmentLength >= 7) {
      const height = byte(offset + 3) * 0x100 + byte(offset + 4);
      const width = byte(offset + 5) * 0x100 + byte(offset + 6);

      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += segmentLength;
  }

  return undefined;
}

function readNaturalImageSize (
  domNode: { getAttribute?: (name: string) => string | null } | undefined,
  url: string | undefined,
  imageNaturalSizes: ReadonlyMap<string, { width: number; height: number }> | undefined,
): { width: number; height: number } | undefined {
  if (domNode == null) { return undefined; }
  let width = parseFloat(domNode.getAttribute?.('data-natural-width') ?? '');
  let height = parseFloat(domNode.getAttribute?.('data-natural-height') ?? '');

  if ((!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) && url != null) {
    const embeddedSize = readEmbeddedImageSize(url);

    if (embeddedSize != null) {
      width = embeddedSize.width;
      height = embeddedSize.height;
    }
  }
  if ((!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    && url != null && imageNaturalSizes != null) {
    const fromMap = imageNaturalSizes.get(url);

    if (fromMap != null) {
      width = fromMap.width;
      height = fromMap.height;
    }
  }

  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : undefined;
}

/** 计算 preserveAspectRatio=meet 时的等比显示尺寸。缺少自然尺寸或无需调整时返回 undefined。 */
function computeMeetFit (
  domNode: { getAttribute?: (n: string) => string | null } | undefined,
  dispW: number,
  dispH: number,
  url?: string,
  imageNaturalSizes?: ReadonlyMap<string, { width: number; height: number }>,
): { width: number; height: number } | undefined {
  if (domNode == null) { return undefined; }
  const par = domNode.getAttribute?.('preserveAspectRatio') ?? '';

  if (/\bslice\b/i.test(par) || /\bnone\b/i.test(par)) { return undefined; } // slice 走裁 UV;none 作者要拉伸
  const naturalSize = readNaturalImageSize(domNode, url, imageNaturalSizes);

  if (naturalSize == null) { return undefined; }
  const { width: iw, height: ih } = naturalSize;

  if (dispW <= 0 || dispH <= 0) { return undefined; }
  if (Math.abs(dispW / dispH - iw / ih) < 1e-4) { return undefined; } // 比一致→无需 fit

  const boxAspect = dispW / dispH;
  const imgAspect = iw / ih;

  if (imgAspect > boxAspect) { // 按宽铺满，垂直方向留白
    return { width: dispW, height: dispW / imgAspect };
  }

  // 按高铺满，水平方向留白
  return { width: dispH * imgAspect, height: dispH };
}

/** 计算 preserveAspectRatio=slice 时的覆盖尺寸。缺少自然尺寸或无需调整时返回 undefined。 */
function computeSliceCoverFit (
  domNode: { getAttribute?: (n: string) => string | null } | undefined,
  dispW: number,
  dispH: number,
  url?: string,
  imageNaturalSizes?: ReadonlyMap<string, { width: number; height: number }>,
): { width: number; height: number } | undefined {
  if (domNode == null) { return undefined; }
  const par = domNode.getAttribute?.('preserveAspectRatio') ?? '';

  if (!/\bslice\b/i.test(par)) { return undefined; }
  const naturalSize = readNaturalImageSize(domNode, url, imageNaturalSizes);

  if (naturalSize == null) { return undefined; }
  const { width: iw, height: ih } = naturalSize;

  if (dispW <= 0 || dispH <= 0) { return undefined; }
  if (Math.abs(dispW / dispH - iw / ih) < 1e-4) { return undefined; } // 比一致→无需 cover

  const scale = Math.max(dispW / iw, dispH / ih);

  return { width: iw * scale, height: ih * scale };
}

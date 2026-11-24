import { decodeBase64 } from './base64-codec';
import { toClipboardBlobStore } from './clipboard-blob-store';
import type { ClipboardBlobStore } from './clipboard-blob-store';
import { sha1 } from './sha1';
import type { RGBA, FigmaPaint, FigmaBlob, FigmaIRFill } from '../types';

export function parseColor(css: string | null | undefined): RGBA | null {
  if (css === undefined || css === null || css === '') {
    return null;
  }
  const hex = css.match(/^#([0-9a-fA-F]{3,8})$/);

  if (hex) {
    const h = hex[1];

    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16) / 255,
        g: parseInt(h[1] + h[1], 16) / 255,
        b: parseInt(h[2] + h[2], 16) / 255,
        a: 1,
      };
    }
    if (h.length === 6) {
      return {
        r: parseInt(h.slice(0, 2), 16) / 255,
        g: parseInt(h.slice(2, 4), 16) / 255,
        b: parseInt(h.slice(4, 6), 16) / 255,
        a: 1,
      };
    }
    if (h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16) / 255,
        g: parseInt(h.slice(2, 4), 16) / 255,
        b: parseInt(h.slice(4, 6), 16) / 255,
        a: parseInt(h.slice(6, 8), 16) / 255,
      };
    }
  }
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);

  if (!m) {
    return null;
  }

  return {
    r: parseInt(m[1]) / 255,
    g: parseInt(m[2]) / 255,
    b: parseInt(m[3]) / 255,
    a: m[4] !== undefined ? parseFloat(m[4]) : 1,
  };
}

export function makeSolidPaint(color: RGBA): FigmaPaint {
  return {
    type: 'SOLID',
    color: { r: color.r, g: color.g, b: color.b, a: 1 },
    opacity: color.a,
    visible: true,
    blendMode: 'NORMAL',
  };
}

export function mapIRFillPaint(fill: FigmaIRFill, size?: { width: number; height: number }): FigmaPaint {
  if (fill.type === 'SOLID') {
    return makeSolidPaint(fill.color);
  }
  const radians = ((Number.isFinite(fill.angleDeg) ? fill.angleDeg : 180) * Math.PI) / 180;
  const width = size !== undefined && Number.isFinite(size.width) && size.width > 0 ? size.width : 1;
  const height = size !== undefined && Number.isFinite(size.height) && size.height > 0 ? size.height : 1;
  const directionX = Math.sin(radians);
  const directionY = -Math.cos(radians);
  const length = Math.abs(width * directionX) + Math.abs(height * directionY);
  const deltaX = directionX * length / width;
  const deltaY = directionY * length / height;

  return {
    type: 'GRADIENT_LINEAR', opacity: 1, visible: true, blendMode: 'NORMAL',
    stops: fill.stops.map(stop => ({ color: stop.color, position: stop.position })),
    transform: {
      // Kiwi paint space runs from (1, 0) to (0, 0), unlike CSS's forward axis.
      m00: -deltaX, m01: deltaY, m02: (1 + deltaX) / 2,
      m10: -deltaY, m11: -deltaX, m12: (1 + deltaY) / 2,
    },
  };
}

function imageHash(bytes: Uint8Array): number[] {
  return Array.from(sha1(bytes));
}

export function dataUrlToUint8Array(dataUrl: string | null | undefined): Uint8Array | null {
  if (!dataUrl) {
    return null;
  }
  const m = dataUrl.match(/^data:[^;]+;base64,(.+)$/);

  if (!m) {
    return null;
  }

  return decodeBase64(m[1]);
}

export function makeImageFillPaint(
  imgData: Uint8Array,
  blobStoreOrBlobs: ClipboardBlobStore | FigmaBlob[],
): FigmaPaint {
  const blobStore = toClipboardBlobStore(blobStoreOrBlobs);
  const blobIndex = blobStore.add('image', imgData);

  return {
    type: 'IMAGE',
    opacity: 1,
    visible: true,
    blendMode: 'NORMAL',
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    image: {
      hash: imageHash(imgData),
      name: '',
      dataBlob: blobIndex,
    },
    animationFrame: 0,
    imageScaleMode: 'STRETCH',
    rotation: 0,
    scale: 1,
  };
}

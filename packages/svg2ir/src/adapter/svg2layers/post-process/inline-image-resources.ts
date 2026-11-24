import { SVGConverterError, SVG_CONVERTER_ERROR_CODES } from '../../../common/errors';
import type { SVGImageResource, SVGImageResourceLoader, SVGStaticLayer } from '../types';

function encodeBase64(data: Uint8Array): string {
  const chunks: string[] = [];

  for (let offset = 0; offset < data.length; offset += 8192) {
    chunks.push(String.fromCharCode(...Array.from(data.subarray(offset, offset + 8192))));
  }

  return btoa(chunks.join(''));
}

function readImageDataUrl(url: string): SVGImageResource {
  const comma = url.indexOf(',');

  if (comma < 0) { throw new Error('Invalid image data URL.'); }
  const [mimeType, ...parameters] = url.slice(5, comma).split(';');
  const payload = url.slice(comma + 1);

  if (parameters.some(parameter => parameter.toLowerCase() === 'base64')) {
    const decoded = atob(payload);

    return { mimeType, data: Uint8Array.from(decoded, character => character.charCodeAt(0)) };
  }
  const data: number[] = [];
  const encoder = new TextEncoder();
  const tokens = payload.match(/%[\da-f]{2}|[^%]+|%/gi) ?? [];

  for (const token of tokens) {
    if (token === '%') { throw new Error('Invalid percent-encoded image data.'); }
    if (token.startsWith('%')) {
      data.push(parseInt(token.slice(1), 16));
    } else {
      for (const byte of encoder.encode(token)) { data.push(byte); }
    }
  }

  return { mimeType, data: new Uint8Array(data) };
}

async function fetchImageResource(url: string): Promise<SVGImageResource> {
  const parsed = new URL(url);

  if (!['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
    throw new Error('Use loadImage to read local or non-HTTP image resources.');
  }
  const response = await fetch(url);

  if (!response.ok) { throw new Error(`Image request failed: HTTP ${response.status}.`); }

  return {
    data: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type')?.split(';')[0].trim() ?? '',
  };
}

/** 将图片资源写入 JSON，避免输出依赖外链、本地目录或临时 blob 地址。 */
export async function inlineImageResources(
  layers: SVGStaticLayer[],
  loadImage: SVGImageResourceLoader = fetchImageResource,
): Promise<SVGStaticLayer[]> {
  const resources = new Map<string, string>();
  const result: SVGStaticLayer[] = [];

  for (const layer of layers) {
    if (layer.type !== 'image') {
      result.push(layer);
      continue;
    }
    let url = resources.get(layer.url);

    if (url == null) {
      try {
        const resource = /^data:/i.test(layer.url) ? readImageDataUrl(layer.url) : await loadImage(layer.url);
        const mimeType = resource.mimeType.trim().toLowerCase();

        if (!/^image\/[a-z\d.+-]+$/.test(mimeType)) { throw new Error('Missing or invalid image MIME type.'); }
        if (resource.data.length === 0) { throw new Error('Empty image resource.'); }
        url = `data:${mimeType};base64,${encodeBase64(resource.data)}`;
        resources.set(layer.url, url);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        throw new SVGConverterError(SVG_CONVERTER_ERROR_CODES.LAYERS_CONVERSION_FAILED,
          `[svg2ge:layers] Failed to inline image ${layer.id}: ${reason}`, {
            stage: 'layers-resources', sourceId: layer.id, reason,
          });
      }
    }
    result.push({ ...layer, url });
  }

  return result;
}

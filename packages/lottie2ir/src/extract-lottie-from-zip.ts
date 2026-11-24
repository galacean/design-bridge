import JSZip, { type JSZipObject } from '@progress/jszip-esm';
import type { LottieZipResources } from './common/conversion-types';
import { LottieConverterError, LOTTIE_CONVERTER_ERROR_CODES } from './common/converter-error';

/**
 * Extracts Lottie JSON and supported image or font resources from a ZIP archive.
 *
 * Include a single `.json` file in the archive, containing the Lottie animation.
 * Resource Data URLs are keyed by archive path, and `dirPath` identifies the JSON file's parent directory.
 *
 * @throws `LottieConverterError` when the archive is invalid or contains no JSON file.
 */
export async function extractLottieFromZip(zipData: ArrayBuffer): Promise<LottieZipResources & { json: string }> {
  let zip: JSZip;

  try {
    zip = await new JSZip().loadAsync(zipData);
  } catch (error) {
    throw new LottieConverterError(LOTTIE_CONVERTER_ERROR_CODES.ZIP_PARSE_FAILED, 'Failed to parse the ZIP archive.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const resourceEntries: Array<{ file: JSZipObject; mimeType: string }> = [];
  let jsonEntry: JSZipObject | undefined;

  for (const relativePath in zip.files) {
    const file = zip.files[relativePath];
    const mimeType = resolveZipResourceMimeType(relativePath);

    if (!file.dir && mimeType != null && !relativePath.includes('_MACOSX')) {
      resourceEntries.push({ file, mimeType });
    }

    if (!file.dir && /\.json$/i.test(relativePath) && !relativePath.includes('_MACOSX')) {
      jsonEntry = file;
    }
  }

  if (jsonEntry == null) {
    throw new LottieConverterError(
      LOTTIE_CONVERTER_ERROR_CODES.ZIP_JSON_NOT_FOUND,
      'No JSON file was found in the ZIP archive.',
    );
  }

  const json = await jsonEntry.async('string');
  const dirPath = jsonEntry.name.split('/').slice(0, -1).join('/');
  const resources: Record<string, string> = {};

  await Promise.all(
    resourceEntries.map(async ({ file, mimeType }) => {
      const buffer = await file.async('arraybuffer');
      const uint8Array = new Uint8Array(buffer);
      let binary = '';

      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const base64 = btoa(binary);

      resources[file.name] = `data:${mimeType};base64,${base64}`;
    }),
  );

  return { json, resources, dirPath };
}

function resolveZipResourceMimeType(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    case 'ttf':
      return 'font/ttf';
    case 'otf':
      return 'font/otf';
    default:
      return undefined;
  }
}

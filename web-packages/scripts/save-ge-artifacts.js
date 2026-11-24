/**
 * 生成可保存产物（JSON 文本 + 图片二进制）
 *
 * @param sceneJSON - GE JSON 数据
 * @param imageBuffers - 图片二进制映射（key 为 ZIP 内路径）
 * @param dirPath - ZIP 内 JSON 文件所在的目录前缀
 * @param jsonFileName - JSON 文件名（默认 `result.json`）
 *
 * 兼容说明：保留旧签名 `save(sceneJSON, imageBuffers, dirPath, legacyOutputDir, jsonFileName?)`。
 * 该签名中的 `legacyOutputDir` 仅用于兼容历史调用，当前实现不会直接写盘。
 *
 * @example
 * ```ts
 * const artifacts = await saveGEArtifacts(scene, images, dirPath, 'scene.json');
 * ```
 */
function normalizePath(value) {
  return value.replace(/[\\/]+/g, '/').replace(/^\//, '');
}

function getBaseName(value) {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf('/');

  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function getExtension(value) {
  const base = getBaseName(value);
  const index = base.lastIndexOf('.');

  return index > 0 ? base.slice(index).toLowerCase() : '.png';
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }

  return new Uint8Array(data);
}

export async function saveGEArtifacts(
  sceneJSON,
  imageBuffers,
  dirPath,
  outputDirOrJsonFileName = 'result.json',
  jsonFileName,
) {
  const resolvedJsonFileName =
    jsonFileName ?? (outputDirOrJsonFileName.endsWith('.json') ? outputDirOrJsonFileName : 'result.json');

  const zipPathToLocalName = {};
  let imageIndex = 0;

  for (const zipImagePath of Object.keys(imageBuffers)) {
    const extension = getExtension(zipImagePath);
    const localFileName = `img_${imageIndex}${extension}`;

    zipPathToLocalName[zipImagePath] = localFileName;
    imageIndex++;
  }

  const imageFiles = [];
  const zipPaths = Object.keys(imageBuffers);

  for (const imageEntry of sceneJSON.images) {
    const originalUrl = imageEntry.url;

    const fullZipPath = dirPath ? normalizePath([dirPath, originalUrl].join('/')) : normalizePath(originalUrl);
    const normalizedOriginalUrl = normalizePath(originalUrl);
    let matches = zipPaths.filter(zipPath => normalizePath(zipPath) === fullZipPath);

    if (matches.length === 0) {
      matches = zipPaths.filter(zipPath => normalizePath(zipPath).endsWith(`/${normalizedOriginalUrl}`));
    }
    if (matches.length === 0) {
      matches = zipPaths.filter(zipPath => getBaseName(zipPath) === getBaseName(normalizedOriginalUrl));
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous image path: ${originalUrl}`);
    }
    const matchedZipPath = matches[0];

    if (matchedZipPath != null && matchedZipPath !== '' && zipPathToLocalName[matchedZipPath]) {
      const localFileName = zipPathToLocalName[matchedZipPath];
      const relativePath = `images/${localFileName}`;

      imageFiles.push({
        sourcePath: normalizePath(matchedZipPath),
        fileName: localFileName,
        relativePath,
        bytes: toUint8Array(imageBuffers[matchedZipPath]),
      });
      imageEntry.url = relativePath;
    }
  }

  const jsonText = JSON.stringify(sceneJSON, null, 2);

  return {
    jsonFileName: resolvedJsonFileName,
    jsonRelativePath: resolvedJsonFileName,
    jsonText,
    imageFiles,
  };
}

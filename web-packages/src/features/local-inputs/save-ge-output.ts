async function saveFile(route: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`/api/lottie2ge/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`保存失败：HTTP ${response.status}`);
  }
  const result: unknown = await response.json();

  if (result == null || typeof result !== 'object' || !('success' in result) || result.success !== true) {
    throw new Error('保存失败：接口未确认文件已写入');
  }
}

export async function saveGEOutput(scene: Record<string, unknown>, outputDirectory: string): Promise<void> {
  const output = structuredClone(scene);
  const images: unknown[] = Array.isArray(output.images) ? output.images : [];

  // Publish the manifest only after every referenced image has been saved.
  for (let start = 0; start < images.length; start += 4) {
    const results = await Promise.allSettled(images.slice(start, start + 4).map(async (image, offset) => {
      const index = start + offset;

      if (image == null || typeof image !== 'object' || !('url' in image) || typeof image.url !== 'string') {
        throw new Error(`图片 ${index + 1} 的 URL 无效`);
      }
      const source = image.url;
      const data = source.match(/^data:image\/([\w.+-]+);base64,([\s\S]+)$/i);
      let extension: string;

      if (data != null) {
        const mime = data[1].toLowerCase();

        extension = mime === 'jpeg' ? 'jpg' : mime === 'svg+xml' ? 'svg' : mime;
      } else if (/^https?:\/\//i.test(source)) {
        extension = source.match(/\.(\w+?)(?:[?#]|$)/)?.[1] ?? 'png';
      } else if (source.startsWith('data:')) {
        return;
      } else {
        throw new Error(`图片 ${index + 1} 使用相对路径或临时 URL，无法保存关联文件`);
      }
      const relativePath = `images/img_${index}.${extension}`;
      const filePath = `${outputDirectory}/${relativePath}`;

      try {
        await saveFile(data == null ? 'download-image' : 'save-binary',
          data == null ? { url: source, filePath } : { base64: data[2], filePath });
      } catch (error) {
        throw new Error(`图片 ${index + 1} 保存失败，未生成 result.json`, { cause: error });
      }
      image.url = relativePath;
    }));
    const failure = results.find(result => result.status === 'rejected');

    if (failure?.status === 'rejected') {
      throw failure.reason;
    }
  }

  await saveFile('save', {
    filePath: `${outputDirectory}/result.json`,
    content: JSON.stringify(output, null, 2),
  });
}

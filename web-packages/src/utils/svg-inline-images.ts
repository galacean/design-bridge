function fetchImageAsDataUrl(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('图片加载超时')), timeoutMs);

    fetch(url, { mode: 'cors' })
      .then(res => {
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }

        return res.blob();
      })
      .then(blob => {
        const reader = new FileReader();

        reader.onload = () => { clearTimeout(timer); resolve(String(reader.result)); };
        reader.onerror = () => { clearTimeout(timer); reject(new Error('图片读取失败')); };
        reader.readAsDataURL(blob);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/** Inline images because SVG image mode cannot load external resources. The image host must allow CORS. */
export async function inlineSvgImages(svgString: string, timeoutMs = 10000, resourceBaseUrl?: string): Promise<string> {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const images = Array.from(doc.querySelectorAll('image'));

  if (images.length === 0) {
    return svgString;
  }

  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  await Promise.all(images.map(async imgEl => {
    const href = imgEl.getAttribute('href') ?? imgEl.getAttributeNS(XLINK_NS, 'href');

    if (!href || href.startsWith('#') || href.startsWith('data:')) {
      return;
    }
    try {
      const sourceUrl = new URL(href, resourceBaseUrl ?? document.baseURI).href;
      const dataUrl = await fetchImageAsDataUrl(sourceUrl, timeoutMs);

      // Keep the source URL separate from the embedded bytes for IR asset registration.
      imgEl.setAttribute('data-svg2ir-source-url', sourceUrl);
      if (imgEl.hasAttribute('href')) {
        imgEl.setAttribute('href', dataUrl);
      } else if (imgEl.hasAttributeNS(XLINK_NS, 'href')) {
        imgEl.setAttributeNS(XLINK_NS, 'xlink:href', dataUrl);
      } else {
        imgEl.setAttribute('href', dataUrl);
      }

      // Record intrinsic dimensions for preserveAspectRatio fitting.
      try {
        const probe = new Image();

        await new Promise<void>((resolve, reject) => {
          probe.onload = () => resolve();
          probe.onerror = () => reject(new Error('intrinsic decode failed'));
          probe.src = dataUrl;
        });
        imgEl.setAttribute('data-natural-width', String(probe.naturalWidth));
        imgEl.setAttribute('data-natural-height', String(probe.naturalHeight));
      } catch { /* intrinsic 未知,svg2ge meet/slice 走 full-fit 兜底 */ }
    } catch {
      // 内联失败(CORS/404/超时):保留原 url,<img> 模式下该图不显示,不阻断其余内容
    }
  }));

  return new XMLSerializer().serializeToString(doc);
}

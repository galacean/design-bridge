import { isFramePass } from '../core/frame-comparison-config';
import type { FrameResult } from '../core/types';

const PREVIEW_SIZE = 120;

export function renderFrameGallery(
  fixtureName: string, frames: FrameResult[], root: HTMLElement, labels: [string, string],
  options: { caseUrl?: string } = {},
): void {
  const hasFailure = frames.some(frame => frame.comparisonState !== 'source-static' && !isFramePass(frame));

  const renderPassingFrames = new URLSearchParams(window.location.search).get('gallery') === 'all';

  if (!hasFailure && !renderPassingFrames) {
    return;
  }

  if (root.childElementCount === 0) {
    const heading = document.createElement('h2');

    heading.textContent = '帧对比图片';
    heading.className = 'ui-gallery-heading';
    root.appendChild(heading);
  }

  const section = document.createElement('div');

  section.className = 'ui-card ui-frame-gallery';

  const title = document.createElement('h3');

  title.className = 'ui-gallery-title';
  if (options.caseUrl != null) {
    const link = document.createElement('a');

    link.href = options.caseUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = '在新标签页打开单案例对比';
    link.className = 'svg-regression-gallery-link';
    link.textContent = fixtureName;
    title.appendChild(link);
  } else {
    title.textContent = fixtureName;
  }
  section.appendChild(title);

  const scrollContainer = document.createElement('div');

  scrollContainer.className = 'ui-gallery-scroll';

  for (const frame of frames) {
    const pass = isFramePass(frame);
    const group = document.createElement('div');

    group.className = 'ui-gallery-frame';

    const label = document.createElement('div');

    label.className = 'ui-gallery-status';
    const skipped = frame.comparisonState === 'source-static';

    group.dataset.status = skipped ? 'skip' : pass ? 'pass' : 'fail';
    label.textContent = `t=${frame.time.toFixed(2)}s ${skipped ? '⏭ SKIP' : pass ? '✓ PASS' : '✗ FAIL'}`;
    group.appendChild(label);

    const imageRow = document.createElement(options.caseUrl == null ? 'div' : 'a');

    imageRow.className = 'ui-gallery-images';
    if (options.caseUrl != null) {
      imageRow.setAttribute('href', options.caseUrl);
      imageRow.setAttribute('target', '_blank');
      imageRow.setAttribute('rel', 'noopener noreferrer');
      imageRow.setAttribute('title', '在新标签页打开单案例对比');
      imageRow.setAttribute('aria-label', `打开 ${fixtureName} 的单案例对比`);
    }

    const imageEntries: Array<[string, string]> = [
      [frame.lottieDataUrl, labels[0]],
      [frame.effectsDataUrl, labels[1]],
      [frame.diffDataUrl, 'Diff'],
    ];

    for (const [dataUrl, imageTitle] of imageEntries) {
      const img = document.createElement('img');

      img.src = dataUrl;
      img.title = `${imageTitle} t=${frame.time.toFixed(2)}s`;
      img.width = PREVIEW_SIZE;
      img.height = PREVIEW_SIZE;
      img.className = 'ui-gallery-image';
      img.alt = `${imageTitle} at ${frame.time.toFixed(2)}s`;
      imageRow.appendChild(img);
    }

    group.appendChild(imageRow);

    const metrics = document.createElement('div');

    metrics.className = 'ui-gallery-metrics';
    if (frame.format === 'svg') {
      metrics.classList.add('ui-gallery-svg-metrics');
      metrics.title = '全图、中心和模糊为相似度；局部和像素为差异率。';
      metrics.textContent =
        `相似度 全图:${frame.fullSsim.toFixed(3)} 中心:${frame.coreRoiSsim.toFixed(3)} ` +
        `模糊:${frame.blurredSsim.toFixed(3)}\n最大局部差异率:${(frame.localDiffDensity * 100).toFixed(1)}% ` +
        `像素差异率:${(frame.pixelDiffRatio * 100).toFixed(1)}%`;
    } else {
      metrics.textContent =
        `full:${frame.fullSsim.toFixed(3)} roi:${frame.coreRoiSsim.toFixed(3)} ` +
        `blur:${frame.blurredSsim.toFixed(3)} iou:${frame.edgeIoU.toFixed(3)} ` +
        `px:${(frame.pixelDiffRatio * 100).toFixed(1)}%`;
    }
    group.appendChild(metrics);

    scrollContainer.appendChild(group);
  }

  section.appendChild(scrollContainer);
  root.appendChild(section);
}

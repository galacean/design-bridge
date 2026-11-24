import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { captureHTMLReference } from '../helpers/html-fixture';

it('measures text beyond visible hosts and intersects hidden overflow ancestors', async () => {
  const browser = await chromium.launch();

  try {
    const reference = await captureHTMLReference(browser, {
      id: 'text-regions', viewport: { width: 320, height: 200 }, scriptPolicy: 'disabled',
      html: '<style>body{margin:0}div{width:8px;height:24px;font:20px Arial}</style>' +
        '<div id="visible" class="material-icons">overflow</div>' +
        '<div id="hidden" style="overflow:hidden"><span>overflow</span></div>',
      targets: ['visible', 'hidden'].map(id => ({ id, selector: `#${id}`, sceneName: id, requiresImage: false })),
    });
    const [visible, hidden] = reference.targets;

    expect(visible.textRegions[0].width).toBeGreaterThan(visible.width);
    expect(hidden.textRegions[0].width).toBe(hidden.width);
    expect(visible.texts).toEqual(['overflow']);
    expect(hidden.texts).toEqual(['overflow']);
  } finally {
    await browser.close();
  }
});

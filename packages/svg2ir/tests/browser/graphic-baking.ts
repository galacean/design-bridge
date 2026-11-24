import { convertSVGToLayers, type SVGToLayersResult } from '@galacean/svg2ir';

const wrap = (content: string): string => '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">'
  + content + '</svg>';
const nativeText = '<text x="10" y="145" font-family="Arial" font-size="14">Editable</text>';
const graphicCases = [
  ['stroke-transform', '<g transform="translate(40 20) rotate(20 50 30)">'
    + '<rect width="100" height="60" rx="12" fill="#8964ed" stroke="#162244" stroke-width="8"/></g>'],
  ['gradient', '<defs><linearGradient id="paint"><stop stop-color="red"/>'
    + '<stop offset="1" stop-color="blue"/></linearGradient></defs>'
    + '<rect x="20" y="20" width="180" height="100" fill="url(#paint)"/>'],
  ['group-opacity', '<g opacity=".4"><rect x="20" y="20" width="100" height="90" fill="red"/>'
    + '<circle cx="120" cy="80" r="50" fill="blue"/></g>'],
  ['css-group-opacity', '<style>.graphics { opacity: .4; }</style>'
    + '<g class="graphics"><rect x="20" y="20" width="100" height="90" fill="red"/>'
    + '<circle cx="120" cy="80" r="50" fill="blue"/></g>'],
  ['gray-mask', '<defs><mask id="fade"><rect width="240" height="160" fill="white"/>'
    + '<circle cx="100" cy="75" r="30" fill="#888"/></mask></defs>'
    + '<g mask="url(#fade)"><rect x="20" y="20" width="180" height="100" fill="red"/>'
    + '<circle cx="150" cy="85" r="40" fill="blue"/></g>'],
  ['clip', '<defs><clipPath id="clip"><circle cx="120" cy="75" r="50"/></clipPath></defs>'
    + '<g clip-path="url(#clip)"><rect width="200" height="120" fill="orange"/></g>'],
  ['filter-bounds', '<defs><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">'
    + '<feDropShadow dx="6" dy="8" stdDeviation="4"/></filter></defs>'
    + '<rect x="40" y="30" width="100" height="60" fill="orange" filter="url(#shadow)"/>'],
  ['use-inheritance', '<defs><rect id="tile" width="60" height="80"/></defs>'
    + '<use href="#tile" x="20" y="20" fill="red"/><use href="#tile" x="120" y="20" fill="blue"/>'],
  ['use-css-current-color', '<style>.tile { fill: currentColor; }</style>'
    + '<defs><rect id="tile" class="tile" width="60" height="80"/></defs>'
    + '<use href="#tile" x="20" y="20" color="red"/><use href="#tile" x="120" y="20" color="blue"/>'],
  ['pattern', '<defs><pattern id="tile" width="12" height="12" patternUnits="userSpaceOnUse">'
    + '<rect width="6" height="12" fill="purple"/></pattern></defs>'
    + '<rect x="20" y="20" width="180" height="100" fill="url(#tile)"/>'],
  ['css-sibling-selector', '<style>rect { fill: red; } rect + circle { fill: blue; }</style>'
    + '<rect x="10" y="20" width="60" height="80"/><circle cx="150" cy="60" r="40"/>'],
] as const;

function assert(condition: boolean, message: string): void {
  if (!condition) { throw new Error(message); }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Image decode failed.'));
    image.src = url;
  });

  return image;
}

function buildCanvas(size: [number, number]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');

  [canvas.width, canvas.height] = size;

  return canvas;
}

async function drawSource(source: string): Promise<HTMLCanvasElement> {
  const canvas = buildCanvas([240, 160]);

  canvas.getContext('2d')?.drawImage(await loadImage(`data:image/svg+xml,${encodeURIComponent(source)}`), 0, 0);

  return canvas;
}

async function drawImages(result: SVGToLayersResult): Promise<HTMLCanvasElement> {
  const canvas = buildCanvas(result.size);
  const context = canvas.getContext('2d');

  if (context == null) { throw new Error('Missing canvas context.'); }
  for (const layer of result.data) {
    if (layer.type !== 'image') { continue; }
    context.drawImage(await loadImage(layer.url), layer.bbox[0], layer.bbox[1], ...layer.size);
  }

  return canvas;
}

function countChangedPixels(before: HTMLCanvasElement, after: HTMLCanvasElement): number {
  const a = before.getContext('2d')?.getImageData(0, 0, before.width, before.height).data;
  const b = after.getContext('2d')?.getImageData(0, 0, after.width, after.height).data;

  if (a == null || b == null) { throw new Error('Missing pixel data.'); }
  let changed = 0;

  for (let offset = 0; offset < a.length; offset += 4) {
    const alphaA = a[offset + 3] / 255;
    const alphaB = b[offset + 3] / 255;
    const delta = Math.max(Math.abs(a[offset + 3] - b[offset + 3]),
      ...[0, 1, 2].map(channel => Math.abs(a[offset + channel] * alphaA - b[offset + channel] * alphaB)));

    if (delta > 3) { changed++; }
  }

  return changed;
}

const results: Array<{ name: string; passed: boolean; detail?: string }> = [];

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

for (const [name, graphics] of graphicCases) {
  // A native sibling forces subtree extraction rather than a whole-document screenshot.
  await check(name, async () => {
    const result = await convertSVGToLayers(wrap(graphics + nativeText), { rasterScale: 1 });
    const source = await drawSource(wrap(graphics));
    const restored = await drawImages(result);
    const changed = countChangedPixels(source, restored);
    const section = document.createElement('section');

    section.append(`${name}: ${changed} changed pixels`, source, restored);
    document.querySelector('#gallery')?.appendChild(section);
    assert(result.data.some(layer => layer.type === 'text' && layer.content === 'Editable'), 'Native text was lost.');
    assert(!result.warnings.some(warning => warning.code !== 'svg2ge_layers_text_bounds_estimated'
      && warning.code !== 'svg2ge_layers_graphic_baked'),
      JSON.stringify(result.warnings));
    assert(changed === 0, `${changed} pixels changed above tolerance 3.`);
  });
}

await check('successful-baking-warning-and-callback', async () => {
  const reported: string[] = [];
  const result = await convertSVGToLayers(wrap('<rect width="80" height="60"/><circle cx="120" cy="60" r="20"/>'), {
    strict: true, onWarning: warning => reported.push(warning.code),
  });

  assert(result.data.length === 2, 'Graphics were merged or lost.');
  assert(result.warnings.length === 2
    && result.warnings.every(warning => warning.code === 'svg2ge_layers_graphic_baked'),
  'Each baked graphic must produce a warning.');
  assert(JSON.stringify(reported) === JSON.stringify(result.warnings.map(warning => warning.code)),
    'Baking warnings were omitted or reported twice.');
});

await check('native-image-and-text-unchanged', async () => {
  const url = `data:image/svg+xml,${encodeURIComponent(wrap('<rect width="240" height="160" fill="red"/>'))}`;
  const native = `<image href="${url}" x="20" y="20" width="80" height="60"/>${nativeText}`;
  const before = await convertSVGToLayers(wrap(native), {});
  const after = await convertSVGToLayers(wrap('<circle cx="150" cy="50" r="20"/>' + native), {});

  assert(JSON.stringify(before.data.map(({ id: _id, ...layer }) => layer))
    === JSON.stringify(after.data.slice(1).map(({ id: _id, ...layer }) => layer)), 'Native layers changed.');
});

await check('mixed-group-mask-warning', async () => {
  const source = wrap('<defs><mask id="mask"><circle cx="100" cy="60" r="50" fill="white"/></mask></defs>'
    + `<g mask="url(#mask)"><rect width="200" height="120"/>${nativeText}</g>`);
  const result = await convertSVGToLayers(source, {});

  assert(!result.data.some(layer => layer.type === 'image'), 'Mixed native group was rasterized.');
  assert(result.warnings.some(warning => warning.message.includes('contains native')), 'Missing scope warning.');
});

for (const mode of [
  'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light',
  'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]) {
  await check(`blend-${mode}-downgraded`, async () => {
    const graphics = '<rect width="240" height="160" fill="yellow"/>'
      + `<circle cx="120" cy="70" r="40" style="mix-blend-mode:${mode};fill:blue;opacity:.5"/>`;
    const source = wrap(graphics + nativeText);
    const result = await convertSVGToLayers(source, { rasterScale: 1 });
    const expected = await drawSource(wrap(graphics.replace(`mix-blend-mode:${mode}`, 'mix-blend-mode:normal')));
    const restored = await drawImages(result);
    const blendWarnings = result.warnings.filter(warning => warning.code === 'svg2ge_layers_blend_mode_downgraded');

    assert(blendWarnings.length === 1, 'Expected one explicit blend downgrade warning.');
    assert(blendWarnings[0].message.includes(mode), 'The original blend mode was not reported.');
    assert(result.data.map(layer => layer.type).join(',') === 'image,image,text',
      'Graphic layers were merged or lost.');
    assert(countChangedPixels(expected, restored) === 0, 'Downgrade differs from ordinary alpha compositing.');
    const circle = result.data[1];

    if (circle.type !== 'image') { throw new Error('Missing circle image.'); }
    const circleCanvas = buildCanvas([80, 80]);
    const circleContext = circleCanvas.getContext('2d');

    if (circleContext == null) { throw new Error('Missing circle canvas.'); }
    circleContext.drawImage(await loadImage(circle.url), 0, 0, 80, 80);
    const alpha = circleContext.getImageData(40, 40, 1, 1).data[3];

    assert(Math.abs(alpha - 128) <= 1, 'Circle alpha was flattened against its background.');
    let strictFailed = false;

    try {
      await convertSVGToLayers(source, { strict: true });
    } catch (error) {
      strictFailed = error instanceof Error && error.message.includes('downgraded');
    }
    assert(strictFailed, 'Strict mode accepted a blend downgrade.');
  });
}

await check('half-transparent-circle-remains-independent', async () => {
  const circle = '<circle cx="120" cy="70" r="40" fill="blue" opacity=".5"/>';
  const result = await convertSVGToLayers(wrap('<rect width="240" height="160" fill="yellow"/>' + circle + nativeText), {
    rasterScale: 1,
  });
  const changedBackground = { ...result, data: result.data.slice(1).filter(layer => layer.type === 'image') };
  const restored = buildCanvas([240, 160]);
  const context = restored.getContext('2d');

  if (context == null) { throw new Error('Missing canvas.'); }
  context.fillStyle = 'red';
  context.fillRect(0, 0, 240, 160);
  context.drawImage(await drawImages(changedBackground), 0, 0);
  const expected = await drawSource(wrap('<rect width="240" height="160" fill="red"/>' + circle));

  assert(countChangedPixels(expected, restored) === 0, 'Circle pixels depend on the previous background.');
});

await check('high-dpi-logical-dimensions', async () => {
  const result = await convertSVGToLayers(wrap('<rect x="20" y="30" width="80" height="40"/>'), {
    rasterScale: 2, strict: true,
  });
  const layer = result.data[0];

  assert(layer?.type === 'image', 'Expected baked image.');
  if (layer?.type !== 'image') { return; }
  const image = await loadImage(layer.url);

  assert(JSON.stringify(layer.bbox) === '[20,30,100,70]', 'Incorrect logical bounds.');
  assert(JSON.stringify(layer.size) === '[80,40]', 'Raster resolution changed display size.');
  assert(image.naturalWidth === 160 && image.naturalHeight === 80, 'Incorrect raster resolution.');
});

await check('empty-graphic', async () => {
  const result = await convertSVGToLayers(wrap('<rect width="100" height="80" fill="none"/>'), {
    strict: true,
  });

  assert(result.data.length === 0, 'Transparent graphic produced a layer.');
  assert(result.warnings.length === 1 && result.warnings[0].code === 'svg2ge_layers_graphic_baked',
    'Missing empty rasterization warning.');
});

await check('css-mixed-group-effect-warning', async () => {
  const source = wrap('<style>.mixed { opacity: .5; }</style>'
    + `<g class="mixed"><rect width="100" height="80"/>${nativeText}</g>`);
  const result = await convertSVGToLayers(source, {});

  assert(!result.data.some(layer => layer.type === 'image'), 'A CSS mixed-group effect was baked separately.');
  assert(result.warnings.some(warning => warning.message.includes('contains native')),
    'Missing CSS scope warning.');
});

await check('css-mixed-group-blend-downgraded', async () => {
  const source = wrap('<style>.mixed { mix-blend-mode: multiply; }</style>'
    + `<g class="mixed"><rect width="100" height="80"/>${nativeText}</g>`);
  const result = await convertSVGToLayers(source, {});

  assert(result.data.map(layer => layer.type).join(',') === 'image,text', 'The mixed group lost its native content.');
  assert(result.warnings.some(warning => warning.code === 'svg2ge_layers_blend_mode_downgraded'),
    'Missing blend downgrade warning.');
});

await check('native-css-warning-retained', async () => {
  const result = await convertSVGToLayers(wrap('<style>text { fill: red; }</style>'
    + '<rect width="100" height="80"/>' + nativeText), {});

  assert(result.warnings.some(warning => warning.elementSelector === 'style'), 'Native CSS loss was hidden.');
});

await check('missing-reference-warning-and-strict-failure', async () => {
  const source = wrap('<rect width="100" height="80" fill="url(#missing)"/>');
  const result = await convertSVGToLayers(source, {});

  assert(result.warnings.some(warning => warning.message.includes('Missing SVG reference')),
    'Missing resource warning.');
  let failed = false;

  try {
    await convertSVGToLayers(source, { strict: true });
  } catch (error) {
    failed = error instanceof Error && error.message.includes('Missing SVG reference');
  }
  assert(failed, 'Strict mode accepted an unresolved resource.');
});

await check('invalid-scale-strict-failure', async () => {
  let failed = false;

  try {
    await convertSVGToLayers(wrap('<rect width="100" height="80"/>'), { strict: true, rasterScale: 0 });
  } catch (error) {
    failed = error instanceof Error && error.message.includes('rasterScale');
  }
  assert(failed, 'Invalid raster scale was accepted.');
});

await check('animation-stripped-for-static-bake', async () => {
  const source = wrap('<rect x="10" y="10" width="60" height="40" fill="red"/>'
    + '<circle cx="160" cy="30" r="16" fill="blue">'
    + '<animate attributeName="cx" values="140;180;140" dur="2s" repeatCount="indefinite"/></circle>');
  const result = await convertSVGToLayers(source, {});

  assert(result.data.filter(layer => layer.type === 'image').length === 2,
    'Animated scope was not baked in its authored state.');
  assert(result.warnings.some(warning => warning.code === 'svg2ge_layers_animation_stripped'),
    'Missing animation strip warning.');
});

await check('css-animation-isolated-bake-failure', async () => {
  const source = wrap('<rect x="10" y="10" width="60" height="40" fill="red"/>'
    + '<circle cx="160" cy="30" r="16" fill="blue" style="animation-name: pulse; animation-duration: 2s;"/>');
  const result = await convertSVGToLayers(source, {});

  assert(result.data.some(layer => layer.type === 'image'),
    'A CSS animation blocked baking of an unrelated static scope.');
  assert(result.warnings.some(warning => warning.message.includes('Animated graphics')),
    'Missing CSS animation warning.');
});

const failures = results.filter(result => !result.passed);
const status = document.querySelector('#status');
const output = document.querySelector('#results');

if (status != null) { status.textContent = `${results.length - failures.length}/${results.length} passed`; }
if (output != null) { output.textContent = JSON.stringify(results, null, 2); }
document.body.dataset.status = failures.length === 0 ? 'passed' : 'failed';

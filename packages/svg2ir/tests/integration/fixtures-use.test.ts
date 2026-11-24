import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertSVGToIR } from '@galacean/svg2ir';
import type { IRShapeLayer } from '@galacean/animation-ir';

// use 展开成实例层(GE by-value,svg2ir deflatten)。
// 每个产一个实例,引用同一份 geometry 副本;use 的 x/y 平移加到实例 position。

const FIXTURE = path.join(__dirname, '../fixtures/handwritten/use-symbol.svg');

describe('fixture: <use> 展开', () => {
  it('3 个 use 产 3 个实例层(deflatten)', async () => {
    const svg = fs.readFileSync(FIXTURE, 'utf-8');
    const r = convertSVGToIR(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(3);
    for (const l of r.ir.compositions[0].layers) { expect(l.type).toBe('shape'); }
  });

  it('use 引用 polygon → custom 实例层(2 个 star 实例)', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const customs = r.ir.compositions[0].layers.filter(l => (l as unknown as { content: { shapes: Array<{ primitiveType: string }> } }).content.shapes[0].primitiveType === 'custom');

    expect(customs.length).toBe(2); // 两个 use star
  });

  it('use 引用 rect → rectangle 实例层', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const rects = r.ir.compositions[0].layers.filter(l => (l as unknown as { content: { shapes: Array<{ primitiveType: string }> } }).content.shapes[0].primitiveType === 'rectangle');

    expect(rects.length).toBe(1); // 一个 use box
  });

  it('两个 use 引用同一 shape 时，fill 数据互不共享', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <defs><rect id="source" x="0" y="0" width="20" height="20" fill="red"/></defs>
      <use href="#source"/>
      <use href="#source" x="40"/>
    </svg>`;
    const layers = convertSVGToIR(svg).ir.compositions[0].layers.filter((layer): layer is IRShapeLayer => layer.type === 'shape');
    const firstPaint = layers[0]?.content.shapes[0]?.fills[0];
    const secondPaint = layers[1]?.content.shapes[0]?.fills[0];

    expect(firstPaint).toBeDefined();
    expect(secondPaint).toBeDefined();
    if (firstPaint?.type !== 'solid' || secondPaint?.type !== 'solid') {
      throw new Error('expected solid fills');
    }

    firstPaint.color[0] = 0.25;
    expect(secondPaint.color).toEqual([1, 0, 0, 1]);
  });

  it('两个 use 引用同一 symbol 时，嵌套 shape 数据互不共享', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <defs>
        <filter id="effect"><feGaussianBlur stdDeviation="2"/></filter>
        <symbol id="source"><path d="M0 0h20v20h-20z" fill="red"/></symbol>
      </defs>
      <use href="#source" filter="url(#effect)"/>
      <use href="#source" filter="url(#effect)" x="40"/>
    </svg>`;
    const layers = convertSVGToIR(svg).ir.compositions[0].layers.filter((layer): layer is IRShapeLayer => layer.type === 'shape');
    const firstShape = layers[0]?.content.shapes[0];
    const secondShape = layers[1]?.content.shapes[0];

    expect(firstShape).toBeDefined();
    expect(secondShape).toBeDefined();
    if (firstShape == null || secondShape == null || firstShape.primitiveType !== 'custom' || secondShape.primitiveType !== 'custom') {
      throw new Error('expected custom symbol shapes');
    }
    const firstPaint = firstShape.fills[0];
    const secondPaint = secondShape.fills[0];
    const secondPointX = secondShape.customPaths[0]?.points[0]?.x;

    if (firstPaint?.type !== 'solid' || secondPaint?.type !== 'solid') {
      throw new Error('expected symbol shape with solid fills');
    }

    firstPaint.color[0] = 0.25;
    firstShape.customPaths[0].points[0].x = 12;
    expect(secondPaint.color).toEqual([1, 0, 0, 1]);
    expect(secondShape.customPaths[0]?.points[0]?.x).toBe(secondPointX);
  });

  it('use 的 x/y 平移到实例 position', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    // 第二个 use star x=50 y=50, 实例 position = star 中心 + (50,50)
    // star 中心:points(150,50)(180,140)(100,80)(200,80)(120,140) → bbox 中心 (150, 95)
    const l1 = r.ir.compositions[0].layers[1] as { transform: { position: { value: number[] } } };

    expect(l1.transform.position.value[0]).toBeCloseTo(150 + 50, 1);
    expect(l1.transform.position.value[1]).toBeCloseTo(95 + 50, 1);
  });

  it('defs 内声明形状不进 layers(仅作 use 目标)', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    // defs 内 star/box 是声明不渲染,只 use 展开成 3 个实例层(不额外渲 defs 原型)。
    expect(r.ir.compositions[0].layers).toHaveLength(3);
  });

  it('use 引用不存在/非形状目标 → warn', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><use href="#missing"/></svg>`;
    const r = convertSVGToIR(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(0);
    expect(r.warnings.some(w => w.message.includes('missing'))).toBe(true);
  });

  it('use 实例继承祖先 fill=none 时不带出 defs 形状的默认黑色填充', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <defs><rect id="r" x="0" y="0" width="100" height="100"/></defs>
      <g fill="none" stroke="none"><use href="#r" stroke="#999"/></g>
    </svg>`;
    const r = convertSVGToIR(svg);
    const shape = (r.ir.compositions[0].layers[0] as unknown as { content: { shapes: Array<{ fills: unknown[]; strokes: Array<{ width: number }> }> } }).content.shapes[0];

    expect(shape.fills).toHaveLength(0);
    expect(shape.strokes).toHaveLength(1);
    expect(shape.strokes[0]?.width).toBe(1);
  });

  it('use 自身显式 fill 优先于祖先 fill=none', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <defs><rect id="r" x="0" y="0" width="100" height="100"/></defs>
      <g fill="none"><use href="#r" fill="#f00"/></g>
    </svg>`;
    const r = convertSVGToIR(svg);
    const shape = (r.ir.compositions[0].layers[0] as unknown as { content: { shapes: Array<{ fills: Array<{ color?: number[] }> }> } }).content.shapes[0];

    expect(shape.fills).toHaveLength(1);
    expect(shape.fills[0].color).toEqual([1, 0, 0, 1]);
  });

  // <use> 实例需要累乘祖先与自身 transform，并以目标形状中心作为 anchor。

  it('use 累乘祖先 <g translate>:实例落 目标中心+祖先平移,非目标中心', async () => {
    // rect 100×100@(0,0) 中心 (50,50);<g translate(102,42)> 内 use 无 x/y。
    // instance 中心 = (50+102, 50+42) = (152,92)。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <defs><rect id="r" x="0" y="0" width="100" height="100" fill="red"/></defs>
      <g transform="translate(102,42)"><use href="#r"/></g>
    </svg>`;
    const r = convertSVGToIR(svg);
    const l = r.ir.compositions[0].layers[0] as { transform: { position: { value: number[] } } };

    expect(l.transform.position.value[0]).toBeCloseTo(152, 5);
    expect(l.transform.position.value[1]).toBeCloseTo(92, 5);
    expect(l.transform.position.value[0]).not.toBeCloseTo(50, 1);
  });

  it('use 累乘祖先 <g scale>:实例 scale 与位置同步缩放', async () => {
    // <g scale(2)> 内 use:中心 (50,50) → (100,100),scale=[2,2,1]。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <defs><rect id="r" x="0" y="0" width="100" height="100" fill="red"/></defs>
      <g transform="scale(2)"><use href="#r"/></g>
    </svg>`;
    const r = convertSVGToIR(svg);
    const l = r.ir.compositions[0].layers[0] as { transform: { position: { value: number[] }; scale: { value: number[] } } };

    expect(l.transform.position.value[0]).toBeCloseTo(100, 5);
    expect(l.transform.position.value[1]).toBeCloseTo(100, 5);
    expect(l.transform.scale.value[0]).toBeCloseTo(2, 5);
    expect(l.transform.scale.value[1]).toBeCloseTo(2, 5);
  });

  it('use 自身 transform attr 被应用(非丢失)', async () => {
    // use transform="translate(10,20)" 无祖先 g:中心 (50,50) → (60,70)。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <defs><rect id="r" x="0" y="0" width="100" height="100" fill="red"/></defs>
      <use href="#r" transform="translate(10,20)"/>
    </svg>`;
    const r = convertSVGToIR(svg);
    const l = r.ir.compositions[0].layers[0] as { transform: { position: { value: number[] } } };

    expect(l.transform.position.value[0]).toBeCloseTo(60, 5);
    expect(l.transform.position.value[1]).toBeCloseTo(70, 5);
  });

  it('use anchor=目标局部几何中心(非 [0,0,0]),免 ge-ir shapeOffset double-count', async () => {
    // anchor 必须是 目标 shape.position(局部中心),否则 ge-ir layer.ts:315 对 shape 加
    // ratio*(shapeData.position - anchor) 偏移会 double-count 局部中心。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <defs><rect id="r" x="0" y="0" width="100" height="100" fill="red"/></defs>
      <g transform="translate(102,42)"><use href="#r"/></g>
    </svg>`;
    const r = convertSVGToIR(svg);
    const l = r.ir.compositions[0].layers[0] as { transform: { anchor: { value: number[] } }; content: { shapes: Array<{ position: [number, number] }> } };

    // 目标 rect 中心 (50,50) = shape.position;anchor 应 = (50,50),非 (0,0)。
    expect(l.transform.anchor.value[0]).toBeCloseTo(50, 5);
    expect(l.transform.anchor.value[1]).toBeCloseTo(50, 5);
    expect(l.content.shapes[0].position[0]).toBeCloseTo(50, 5);
  });

  // SVG text 可被 use 实例化，目标为 text 时展开为策略富文本 layer。
  it('use 引用 <text> → 展开成 text 实例层(文字不丢)', async () => {
    const svg = fs.readFileSync(path.join(__dirname, '../fixtures/handwritten/use-text.svg'), 'utf-8');
    const r = convertSVGToIR(svg);
    const texts = (r.ir.compositions[0].layers ?? []).filter(l => l.type === 'text').map(l => l.type === 'text' ? l.content.text : '');

    expect(texts.some(t => t != null && t.includes('持续留香'))).toBe(true);
  });

  it('use→text 双实例(纯 use + 带 filter 投影 use 同 id):只展一份文字避免重复绘制', async () => {
    // 同一 text id 的 2 个 use(SVG:纯文字在下 + 带 feOffset 投影叠在上=文字+阴影)。
    // 丢 filter 后两份都纯文字,叠=双份 alpha 变深。规则:带 filter 的 text-use 若该 id 有纯 use,跳过展文字只 warn filter。
    const svg = fs.readFileSync(path.join(__dirname, '../fixtures/handwritten/use-text.svg'), 'utf-8');
    const r = convertSVGToIR(svg);
    const texts = (r.ir.compositions[0].layers ?? []).filter(l => l.type === 'text').map(l => l.type === 'text' ? l.content.text : '');
    const hit = texts.filter(t => t != null && t.includes('持续留香'));

    // 纯 use 展开一份 + 带 filter use 跳过展文字 → 命中一次(不双叠)。
    expect(hit.length).toBe(1);
    expect(r.warnings.some(w => w.code === 'svg2ir_filter_dropped')).toBe(true);
    expect(r.warnings.some(w => w.code === 'svg2ir_element_dropped' && w.message.includes('非可展开形状'))).toBe(false);
  });
  it('use 自身的 x 动画会写入实例 transform', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs><rect id="box" x="0" y="0" width="10" height="10"/></defs>
        <use id="instance" href="#box" x="10">
          <animate attributeName="x" values="10;30" dur="1s" fill="freeze"/>
        </use>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'instance');
    const position = layer?.transform?.position;

    expect(position?.type).toBe('keyframed');
    if (position?.type !== 'keyframed') {
      throw new Error('Expected a keyframed use position.');
    }
    expect(position.keyframes.at(0)?.value).toEqual([15, 5, 0]);
    expect(position.keyframes.at(-1)?.value).toEqual([35, 5, 0]);
  });

  it('use 引用 g 会展开其中的子 use', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <rect id="dot" width="10" height="10" fill="red"/>
          <g id="dots" fill="blue">
            <use href="#dot" x="20"/>
          </g>
        </defs>
        <use id="group-instance" href="#dots"/>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'group-instance_dot');

    expect(layer?.type).toBe('shape');
    expect(layer?.transform?.position).toEqual({ type: 'static', value: [25, 5, 0] });
  });

  it('外层 use 的样式会覆盖引用 group 内的图形', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs><g id="group"><rect width="10" height="10"/></g></defs>
        <use id="instance" href="#group" fill="red"/>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'instance_rect');
    const shape = layer?.type === 'shape' ? layer.content.shapes[0] : undefined;
    const fill = shape?.fills[0];

    expect(fill?.type).toBe('solid');
    if (fill?.type !== 'solid') { throw new Error('Expected a solid fill.'); }
    expect(fill.color).toEqual([1, 0, 0, 1]);
  });

  it('use 引用 g 会应用 group 的 transform 动画', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <g id="group" transform="translate(10 0)">
            <animateTransform attributeName="transform" type="translate" from="0 0" to="20 0" dur="1s" fill="freeze"/>
            <rect width="10" height="10"/>
          </g>
        </defs>
        <use id="instance" href="#group"/>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'instance_rect');
    const position = layer?.transform?.position;

    expect(position?.type).toBe('keyframed');
    if (position?.type !== 'keyframed') {
      throw new Error('Expected a keyframed group transform.');
    }
    expect(position.keyframes.at(0)?.value).toEqual([5, 5, 0]);
    expect(position.keyframes.at(-1)?.value).toEqual([25, 5, 0]);
  });

  it('use 目标的 visibility 动画会保留实例图层', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <rect id="target" width="10" height="10" visibility="hidden">
            <set attributeName="visibility" to="visible" begin="1s" dur="1s" fill="freeze"/>
          </rect>
        </defs>
        <use id="instance" href="#target"/>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'instance');
    const opacity = layer?.transform?.opacity;

    expect(layer?.visible).toBe(true);
    expect(opacity?.type).toBe('keyframed');
    if (opacity?.type !== 'keyframed') {
      throw new Error('Expected a keyframed visibility track.');
    }
    expect(opacity.keyframes.find(keyframe => Math.abs(keyframe.frame - 29.999) < 1e-6)?.value).toBe(0);
    expect(opacity.keyframes.find(keyframe => keyframe.frame === 30)?.value).toBe(1);
  });
  it('use 引用 g 时会保留 group 的静态 transform', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <g id="group" transform="translate(10 0)">
            <rect width="10" height="10">
              <animateTransform attributeName="transform" type="translate" from="0 0" to="20 0" dur="1s" fill="freeze"/>
            </rect>
          </g>
        </defs>
        <use id="instance" href="#group"/>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'instance_rect');
    const position = layer?.transform?.position;

    expect(position?.type).toBe('keyframed');
    if (position?.type !== 'keyframed') {
      throw new Error('Expected a keyframed group transform.');
    }
    expect(position.keyframes.at(0)?.value).toEqual([15, 5, 0]);
    expect(position.keyframes.at(-1)?.value).toEqual([35, 5, 0]);
  });
  it('use 目标动画会保留 use 自身的静态 transform', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <rect id="target" width="10" height="10">
            <animateTransform attributeName="transform" type="translate" from="0 0" to="20 0" dur="1s" fill="freeze"/>
          </rect>
        </defs>
        <use id="instance" href="#target" transform="translate(10 0)"/>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'instance');
    const position = layer?.transform?.position;

    expect(position?.type).toBe('keyframed');
    if (position?.type !== 'keyframed') {
      throw new Error('Expected a keyframed use position.');
    }
    expect(position.keyframes.at(0)?.value).toEqual([15, 5, 0]);
    expect(position.keyframes.at(-1)?.value).toEqual([35, 5, 0]);
  });
  it('use 引用的目标图形会保留自身的几何动画', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <rect id="animated" x="10" y="20" width="20" height="10">
            <animate attributeName="height" from="10" to="30" dur="1s" fill="freeze"/>
          </rect>
        </defs>
        <use id="instance" href="#animated"/>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'instance');
    const scale = layer?.transform?.scale;

    expect(scale?.type).toBe('keyframed');
    if (scale?.type !== 'keyframed') {
      throw new Error('Expected a keyframed use transform.');
    }
    expect(scale.keyframes.at(0)?.value).toEqual([1, 1, 1]);
    expect(scale.keyframes.at(-1)?.value).toEqual([1, 3, 1]);
  });
  it('use 引用 image 会保留 image 的动画', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <image id="source" x="10" y="10" width="20" height="10" href="assets/external-image.png">
            <animate attributeName="x" values="10;30" dur="1s" fill="freeze"/>
          </image>
        </defs>
        <use id="instance" href="#source"/>
      </svg>
    `, { resourceBaseUrl: 'https://example.com/fixtures/image.svg' });
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'instance');

    expect(layer?.type).toBe('image');
    expect(layer?.transform?.position?.type).toBe('keyframed');
  });

  it('use 引用 g 会展开其中的 text', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <g id="group"><text x="10" y="20">Group text</text></g>
        </defs>
        <use id="instance" href="#group"/>
      </svg>
    `);
    const textLayers = result.ir.compositions[0].layers.filter(layer => layer.type === 'text');

    expect(textLayers).toHaveLength(1);
    expect(textLayers[0]?.name).toBe('instance_text');
  });

  it('use 引用 g 会展开其中的 image', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <g id="group"><image id="picture" x="10" y="10" width="20" height="10" href="assets/external-image.png"/></g>
        </defs>
        <use id="instance" href="#group"/>
      </svg>
    `, { resourceBaseUrl: 'https://example.com/fixtures/image.svg' });
    const imageLayers = result.ir.compositions[0].layers.filter(layer => layer.type === 'image');

    expect(imageLayers).toHaveLength(1);
    expect(imageLayers[0]?.name).toBe('instance_picture');
  });

  it('use 引用 symbol 会保留子图形的动画', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <symbol id="symbol">
            <rect width="10" height="10">
              <animateTransform attributeName="transform" type="translate" from="0 0" to="20 0" dur="1s" fill="freeze"/>
            </rect>
          </symbol>
        </defs>
        <use id="instance" href="#symbol"/>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'instance_rect_0');
    const position = layer?.transform?.position;

    expect(position?.type).toBe('keyframed');
    if (position?.type !== 'keyframed') {
      throw new Error('Expected a keyframed symbol transform.');
    }
    expect(position.keyframes.at(-1)?.value).toEqual([25, 5, 0]);
  });
});

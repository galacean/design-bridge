import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertSVGToIR } from '@galacean/svg2ir';

// clipPath 解析为 IR mask 几何，挂到被裁图层的 layer.masks?.[0]。

const FIXTURE = path.join(__dirname, '../fixtures/handwritten/clip-path.svg');

describe('fixture: <clipPath> 接入', () => {
  it('被裁层挂 IRMask(clipPath 内 circle 几何→mask.path.points)', async () => {
    const svg = fs.readFileSync(FIXTURE, 'utf-8');
    const r = convertSVGToIR(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(2);
    for (const l of r.ir.compositions[0].layers) {
      expect(l.masks?.[0]).toBeDefined();
      expect(l.masks![0].path.points.length).toBeGreaterThan(0);
    }
  });

  it('clipPath 内 circle 不进 layers(silent,仅作 mask 几何)', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    // 两个被裁 rect 进 layers;clipPath 内 circle/rect 是声明不进。
    for (const l of r.ir.compositions[0].layers) {
      expect(l.type).toBe('shape');
      expect((l as unknown as { content: { shapes: Array<{ primitiveType: string }> } }).content.shapes[0].primitiveType).toBe('rectangle');
    }
  });

  it('rect clipPath: 4 点', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    // 第二个 rect 用 cprect(rect clipPath),path 应 4 点。
    const mask1 = r.ir.compositions[0].layers[1].masks![0];

    expect(mask1.path.points.length).toBe(4);
  });

  it('circle mask 使用 cubic 圆弧控制柄,不退化成 8 边形', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
      <defs><mask id="circle-mask"><circle cx="300" cy="200" r="140" fill="white"/></mask></defs>
      <rect width="600" height="400" fill="white"/>
      <rect width="600" height="400" fill="red" mask="url(#circle-mask)"/>
    </svg>`;
    const r = convertSVGToIR(svg);
    const mask = r.ir.compositions[0].layers.find(layer => layer.masks?.[0] != null)?.masks?.[0];

    expect(mask).toBeDefined();
    expect(mask!.path.points).toHaveLength(8);
    expect(mask!.path.outTangents.some(tangent => Math.abs(tangent.x) > 1 || Math.abs(tangent.y) > 1)).toBe(true);
    expect(mask!.path.inTangents.some(tangent => Math.abs(tangent.x) > 1 || Math.abs(tangent.y) > 1)).toBe(true);
  });
});

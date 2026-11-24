import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertSVGToIR } from '@galacean/svg2ir';

// 嵌套 g transform:buildTransform 用 accumulateAncestors 显式上溯 DOM 累乘,
// 再乘自身 transform,把 position/anchor/scale/rotation 落到 shape layer。

const FIXTURE = path.join(__dirname, '../fixtures/handwritten/nested-g-transform.svg');

describe('fixture: g transform inherit', () => {
  it('3 个 g 内形状都进 layers,不崩', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    expect(r.ir.compositions[0].layers).toHaveLength(3);
  });

  it('单层 g translate(100,50):position=几何中心+平移,anchor=局部中心', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const l0 = r.ir.compositions[0].layers[0] as { transform: { position: { value: number[] }; anchor: { value: number[] }; scale: { value: number[] } } };

    // rect 中心 (10+20,10+20)=(30,30) + translate(100,50) => (130,80)
    expect(l0.transform.position.value[0]).toBeCloseTo(130, 4);
    expect(l0.transform.position.value[1]).toBeCloseTo(80, 4);
    expect(l0.transform.anchor.value).toEqual([30, 30, 0]);
    expect(l0.transform.scale.value).toEqual([1, 1, 1]);
  });

  it('单层 g matrix(e,f) 等效 translate继承', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const l1 = r.ir.compositions[0].layers[1] as { transform: { position: { value: number[] }; anchor: { value: number[] } } };

    // circle cx=cy=0 + translate(200,100)
    expect(l1.transform.position.value[0]).toBeCloseTo(200, 4);
    expect(l1.transform.position.value[1]).toBeCloseTo(100, 4);
    expect(l1.transform.anchor.value).toEqual([0, 0, 0]);
  });

  it('多层嵌套 g 全部累乘', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const l2 = r.ir.compositions[0].layers[2] as { transform: { position: { value: number[] }; anchor: { value: number[] } } };

    // 外层 translate(50,0) + 内层 translate(50,50) => 中心 (15+100,15+50)=(115,65)
    expect(l2.transform.position.value[0]).toBeCloseTo(115, 4);
    expect(l2.transform.position.value[1]).toBeCloseTo(65, 4);
    expect(l2.transform.anchor.value).toEqual([15, 15, 0]);
  });

  it('无 g transform 的形状:position=局部几何中心,anchor=局部中心', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="10" y="10" width="40" height="40" fill="#000"/></svg>`;
    const r = convertSVGToIR(svg);
    const l0 = r.ir.compositions[0].layers[0] as { transform: { position: { value: number[] }; anchor: { value: number[] } } };

    expect(l0.transform.position.value).toEqual([30, 30, 0]);
    expect(l0.transform.anchor.value).toEqual([30, 30, 0]);
  });

  it('rotate(angle cx cy) keeps the authored pivot instead of rotating around the origin', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <rect id="bar" x="11" y="1" width="2" height="5" transform="rotate(30 12 12)"/>
      </svg>
    `);
    const position = result.ir.compositions[0].layers.find(layer => layer.name === 'bar')!
      .transform!.position as { type: 'static'; value: number[] };

    expect(position.value[0]).toBeCloseTo(16.25, 5);
    expect(position.value[1]).toBeCloseTo(4.638785, 5);
  });

  it('applies viewBox scaling when physical viewport lengths use px units', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="50px" height="50px" viewBox="0 0 100 100">
        <circle id="dot" cx="80" cy="50" r="6"/>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'dot')!;
    const position = layer.transform!.position as { type: 'static'; value: number[] };
    const scale = layer.transform!.scale as { type: 'static'; value: number[] };

    expect(result.ir.compositions[0].width).toBe(50);
    expect(result.ir.compositions[0].height).toBe(50);
    expect(position.value).toEqual([40, 25, 0]);
    expect(scale.value).toEqual([0.5, 0.5, 1]);
  });
});

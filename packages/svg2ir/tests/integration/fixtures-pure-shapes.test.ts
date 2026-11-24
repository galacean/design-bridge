import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertSVGToIR } from '@galacean/svg2ir';
import type {
  IRCustomShape,
  IREllipseShape,
  IRLayer,
  IRRectangleShape,
  IRShape,
  IRSolidPaint,
} from '@galacean/animation-ir';

// handwritten fixture：纯形状（无 text/image），用于覆盖基础几何输出。

const FIXTURE = path.join(__dirname, '../fixtures/handwritten/pure-shapes.svg');

function layerShape (ir: { compositions: Array<{layers: IRLayer[]}> }, idx: number): IRShape | undefined {
  // SVG 文档顺序与 IR 都是 bottom-first，文档序第 idx 个就是 layers[idx]。
  const layer = ir.compositions[0].layers[idx] as unknown as { content?: { shapes?: IRShape[] } };

  return layer?.content?.shapes?.[0];
}

describe('fixture: 纯形状(无 text/image)', () => {
  it('7 类形状全解析成 IRShapeLayerNode,warnings 空', async () => {
    const svg = fs.readFileSync(FIXTURE, 'utf-8');
    const r = convertSVGToIR(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(7);
    expect(r.warnings).toEqual([]);
    for (const l of r.ir.compositions[0].layers) { expect(l.type).toBe('shape'); }
  });

  it('rect: primitiveType/position/尺寸/fill', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const s = layerShape(r.ir, 0) as IRRectangleShape;

    expect(s.primitiveType).toBe('rectangle');
    expect(s.position).toEqual([60, 40]);
    expect(s.width).toBe(100);
    expect(s.height).toBe(60);
    expect(s.fills).toHaveLength(1);
    expect(s.fills[0]).toMatchObject({ type: 'solid' });
    // #1677ff → [0.0863, 0.4667, 1, 1]
    const solidFill = s.fills[0] as IRSolidPaint;

    expect(solidFill.color[0]).toBeCloseTo(0.0863, 4);
    expect(solidFill.color[1]).toBeCloseTo(0.4667, 4);
    expect(solidFill.color[2]).toBeCloseTo(1, 4);
  });

  it('circle: ellipse primitiveType,cx/cy/r', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const s = layerShape(r.ir, 1) as IREllipseShape;

    expect(s.primitiveType).toBe('ellipse');
    expect(s.position).toEqual([250, 50]);
    expect(s.xRadius).toBe(30);
    expect(s.yRadius).toBe(30);
  });

  it('ellipse: fill=none + stroke(颜色/宽度)', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const s = layerShape(r.ir, 2) as IREllipseShape;

    expect(s.primitiveType).toBe('ellipse');
    expect(s.position).toEqual([350, 50]);
    expect(s.xRadius).toBe(40);
    expect(s.yRadius).toBe(20);
    expect(s.fills).toEqual([]);
    expect(s.strokes).toHaveLength(1);
    expect(s.strokes[0]?.width).toBe(3);
  });

  it('polygon: custom + closed + 顶点相对质心', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const s = layerShape(r.ir, 3) as IRCustomShape;

    expect(s.primitiveType).toBe('custom');
    expect(s.position).toEqual([150, 225]); // 三点质心
    expect(s.customPaths[0].closed).toBe(true);
    // 顶点减质心，匹配 IR shape 局部坐标
    const pts = s.customPaths[0].points as Array<{ x: number; y: number }>;

    expect(pts).toEqual([{ x: -100, y: 25 }, { x: 0, y: -25 }, { x: 100, y: 25 }]);
  });

  it('polyline: custom + open + 仅 stroke', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const s = layerShape(r.ir, 4) as IRCustomShape;

    expect(s.primitiveType).toBe('custom');
    expect(s.customPaths[0].closed).toBe(false);
    expect(s.fills).toEqual([]);
    expect(s.strokes).toHaveLength(1);
  });

  it('line: custom + 两点 + 质心定位', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const s = layerShape(r.ir, 5) as IRCustomShape;

    expect(s.primitiveType).toBe('custom');
    expect(s.position).toEqual([200, 280]); // 两端中点
    expect(s.customPaths[0].closed).toBe(false);
    const pts = s.customPaths[0].points as Array<{ x: number; y: number }>;

    expect(pts).toEqual([{ x: -190, y: 0 }, { x: 190, y: 0 }]);
  });

  it('path(Q 二次贝塞尔): Q→C 升阶,切线相对', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const s = layerShape(r.ir, 6) as IRCustomShape;

    expect(s.primitiveType).toBe('custom');
    expect(s.position).toEqual([200, 150]);
    expect(s.customPaths[0].closed).toBe(false);
    const out0 = s.customPaths[0].outTangents[0];

    // Q(200,100) 升阶 C:C1 = P0 + 2/3*(Q1-P0) = (10,150)+2/3*(190,-50) ≈ (136.67,116.67)
    // 减 position(200,150): outTangent ≈ (-63.33,-33.33)
    expect(out0.x).toBeCloseTo(126.67 - 0, 1);
  });
});

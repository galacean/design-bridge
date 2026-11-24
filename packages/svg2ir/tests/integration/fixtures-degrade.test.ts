import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertSVGToIR } from '@galacean/svg2ir';
import { SVG2IR_WARNING_CODES } from '../../src/common/types';

// C 组降级项:GE 缺失或差异的能力,svg2ir 发 warning + 兜底继续渲染。
// dash(GE无)/filter(GE无逐元素)/marker(GE无)/vector-effect(GE无)/skew(GE无skew通道)。

const FIXTURE = path.join(__dirname, '../fixtures/handwritten/degrade-features.svg');

describe('fixture: C组降级项 warn 全覆盖', () => {
  it('各降级项发对应 warn', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const codes = new Set(r.warnings.map(w => w.code));

    expect(codes.has(SVG2IR_WARNING_CODES.STROKE_DASH_DROPPED)).toBe(true);
    expect(codes.has(SVG2IR_WARNING_CODES.FILTER_DROPPED)).toBe(true);
    // marker/skew/vector-effect 走 ELEMENT_DROPPED 笼统码
    expect(codes.has(SVG2IR_WARNING_CODES.ELEMENT_DROPPED)).toBe(true);
  });

  it('降级项形状仍渲染(不崩溃)', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    // line/dash(直线已合成)+ polygon/dash(闭合,降级)+ rect/filter + circle/marker + rect/vec-effect + rect/skew g = 6 形状层
    expect(r.ir.compositions[0].layers.length).toBeGreaterThanOrEqual(4);
  });

  it('dasharray 单独 warn 内容含 dasharray(闭合 polygon 不可合成 → 降级 warn)', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const dashWarn = r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.STROKE_DASH_DROPPED);

    expect(dashWarn?.message).toContain('dasharray');
  });

  it('skew transform warn', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const skewWarn = r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.SKEW_DROPPED);

    expect(skewWarn).toBeDefined();
    expect(skewWarn?.message).toContain('skew');
  });
});
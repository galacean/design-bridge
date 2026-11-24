import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertSVGToIR } from '@galacean/svg2ir';
import { SVG2IR_WARNING_CODES } from '../../src/common/types';

// 高级降级场景：pattern、radial gradient 焦点、渐变变换和不支持的 SMIL 属性。
// dominant-baseline + text drop-shadow + tspan per-span 卡 IR schema(无字段),标 known limit 不在 svg2ir 可解。

const FIXTURE = path.join(__dirname, '../fixtures/handwritten/p1-degrade.svg');

describe('fixture: advanced degradation warnings', () => {
  it('pattern 精确判定:fill=url(#pattern) → PATTERN_DROPPED warn', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    expect(r.warnings.some(w => w.code === SVG2IR_WARNING_CODES.PATTERN_DROPPED)).toBe(true);
  });

  it('radial fx 非默认焦点 → warn(focal 钳中心)', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    expect(r.warnings.some(w => w.code === SVG2IR_WARNING_CODES.ELEMENT_DROPPED && w.message.includes('fx'))).toBe(true);
  });

  it('spreadMethod repeat → warn', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    expect(r.warnings.some(w => w.message.includes('spreadMethod'))).toBe(true);
  });

  it('SMIL <animate> 已映射时不误报 dropped,并产出关键帧', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const transform = r.ir.compositions[0].layers[3].transform!;

    expect(r.warnings.some(w => w.message.includes('animate'))).toBe(false);
    expect(transform.position?.type === 'keyframed').toBe(true);
  });

  it('dominant-baseline:svg2ir 无 verticalAlign 字段,降级不崩(text 仍产)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="10" y="30" font-size="20" fill="#000" dominant-baseline="middle">hi</text></svg>`;
    const r = convertSVGToIR(svg);

    expect(r.ir.compositions[0].layers[0].type).toBe('text');
  });

});

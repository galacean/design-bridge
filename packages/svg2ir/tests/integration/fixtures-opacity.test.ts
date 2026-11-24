import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertSVGToIR } from '@galacean/svg2ir';

// 通用属性: opacity→layer.transform.opacity(0-1);display:none/visibility:hidden→layer.visible=false。
// 不可见元素仍进 layers(visible=false,Effects Runtime 不渲),符合 SVG 语义。

const FIXTURE = path.join(__dirname, '../fixtures/handwritten/opacity-visible.svg');

function layerOp (l: { transform: { opacity: { value: number } } }) { return l.transform.opacity.value; }

describe('fixture: 通用属性 opacity/display/visibility', () => {
  it('opacity 映射到 layer.transform.opacity', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    expect(r.ir.compositions[0].layers).toHaveLength(4);
    expect(layerOp(r.ir.compositions[0].layers[0] as never)).toBeCloseTo(0.5, 4); // opacity=0.5（文档第 1 层）
  });

  it('opacity=0 仍进 layers(visible 不受 opacity 影响)', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    expect(layerOp(r.ir.compositions[0].layers[3] as never)).toBe(0);
    expect(r.ir.compositions[0].layers[3].visible).toBe(true); // opacity=0 不等于 hidden,visible 仍 true
  });

  it('display:none → visible=false', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    expect(r.ir.compositions[0].layers[1].visible).toBe(false);
  });

  it('visibility:hidden → visible=false', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));

    expect(r.ir.compositions[0].layers[2].visible).toBe(false);
  });

  it('text 层也接 opacity', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><text x="10" y="30" font-size="20" fill="#000" opacity="0.3">hi</text></svg>`;
    const r = convertSVGToIR(svg);

    expect((r.ir.compositions[0].layers[0] as { transform: { opacity: { value: number } } }).transform.opacity.value).toBeCloseTo(0.3, 4);
  });

  it('image 层也接 opacity/visible', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><image x="10" y="10" width="50" height="30" href="https://x/a.png" opacity="0.7" display="none"/></svg>`;
    const r = convertSVGToIR(svg);
    const l0 = r.ir.compositions[0].layers[0] as { visible: boolean; transform: { opacity: { value: number } } };

    expect(l0.visible).toBe(false);
    expect(l0.transform.opacity.value).toBeCloseTo(0.7, 4);
  });
});
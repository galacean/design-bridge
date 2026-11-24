import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertSVGToIR } from '@galacean/svg2ir';

// image 解析为 IRImageLayerNode，保留资源引用、显示框和 preserveAspectRatio 几何。
// 参考 lottie2ge image 层:asset{url,w,h} + localBounds{x:0,y:0,w,h} + anchor=中心 + position=中心。

const FIXTURE = path.join(__dirname, '../fixtures/handwritten/image.svg');
const RESOURCE_BASE_URL = 'https://example.com/fixtures/image.svg';

function convertImageSVG(
  svg: string,
  options?: Parameters<typeof convertSVGToIR>[1],
): ReturnType<typeof convertSVGToIR> {
  return convertSVGToIR(svg, { ...options, resourceBaseUrl: RESOURCE_BASE_URL });
}

describe('fixture: <image> 接入', () => {
  it('两个 <image> 产 2 个 IRImageLayerNode,正确填 asset/localBounds/build-transform', async () => {
    const svg = fs.readFileSync(FIXTURE, 'utf-8');
    const r = convertImageSVG(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(2);
    for (const l of r.ir.compositions[0].layers) {
      expect(l.type).toBe('image');
    }
    const l0 = r.ir.compositions[0].layers[0] as unknown as { content: { assetId: string }; localBounds: { x: number; y: number; width: number; height: number }; transform: { position: { value: number[] }; anchor: { value: number[] } } };

    // xlink:href(SVG1)读取
    expect(l0.content.assetId).toContain('assets/');
    // localBounds 镜像 asset,x/y 恒 0(对齐 lottie)
    expect(l0.localBounds).toEqual({ x: 0, y: 0, width: 200, height: 150 });
    // position/anchor 是图片中心
    expect(l0.transform.position.value).toEqual([120, 95, 0]); // 20+100, 20+75
    expect(l0.transform.anchor.value).toEqual([100, 75, 0]); // w/2, h/2
  });

  it('href(SVG2)与 xlink:href 都能读', async () => {
    const r = convertImageSVG(fs.readFileSync(FIXTURE, 'utf-8'));
    const l1 = r.ir.compositions[0].layers[1] as { content: { assetId: string } };

    // 第二个用 href(SVG2),也应该拿到 url
    expect(l1.content.assetId).toContain('assets/');
  });

  it('无 href 的 <image> 跳过 + warn', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><image x="10" y="10" width="50" height="50"/></svg>`;
    const r = convertImageSVG(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(0);
    expect(r.warnings.some(w => w.code === 'svg2ir_element_dropped')).toBe(true);
  });

  // preserveAspectRatio 默认 meet：框比例与自然比例不同时使用 fitted 几何并保持显示框中心。
  type ImgLayer = { localBounds: { x: number; y: number; width: number; height: number }; transform: { position: { value: number[] }; scale: { value: number[] }; anchor: { value: number[] } } };

  it('meet:图比框宽→按宽铺满,上下留白(fitted height 收窄)', async () => {
    // 自然 200×100(aspect 2) 显示框 100×100(aspect 1):imgAspect>boxAspect→fw=100,fh=50
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><image x="0" y="0" width="100" height="100" data-natural-width="200" data-natural-height="100" href="assets/external-image.png"/></svg>`;
    const r = convertImageSVG(svg);
    const l = r.ir.compositions[0].layers[0] as ImgLayer;

    expect(l.localBounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(l.transform.anchor.value).toEqual([50, 25, 0]); // fitted 中心
    expect(l.transform.position.value).toEqual([50, 50, 0]); // 显示框中心不动
  });

  it('meet:图比框高→按高铺满,左右留白(fitted width 收窄)', async () => {
    // 自然 100×200(aspect 0.5) 显示框 100×100(aspect 1):imgAspect<boxAspect→fh=100,fw=50
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><image x="10" y="10" width="100" height="100" data-natural-width="100" data-natural-height="200" href="assets/external-image.png"/></svg>`;
    const r = convertImageSVG(svg);
    const l = r.ir.compositions[0].layers[0] as ImgLayer;

    expect(l.localBounds).toEqual({ x: 0, y: 0, width: 50, height: 100 });
    expect(l.transform.anchor.value).toEqual([25, 50, 0]);
    expect(l.transform.position.value).toEqual([60, 60, 0]); // 10+50, 10+50
  });

  it('meet:框比例与自然一致→不干预(=full-fit)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><image x="0" y="0" width="100" height="50" data-natural-width="200" data-natural-height="100" href="assets/external-image.png"/></svg>`;
    const r = convertImageSVG(svg);
    const l = r.ir.compositions[0].layers[0] as ImgLayer;

    expect(l.localBounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(l.transform.anchor.value).toEqual([50, 25, 0]);
  });

  it('meet:无 data-natural-* → 使用 full-fit 拉伸', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><image x="0" y="0" width="100" height="100" href="assets/external-image.png"/></svg>`;
    const r = convertImageSVG(svg);
    const l = r.ir.compositions[0].layers[0] as ImgLayer;

    expect(l.localBounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(l.transform.anchor.value).toEqual([50, 50, 0]);
  });

  it('meet:无 data-natural-* 但传 options.imageNaturalSizes → 仍按 meet 拟合(Node 生产路径)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><image x="0" y="0" width="100" height="100" href="assets/external-image.png"/></svg>`;
    const sizes = new Map([['assets/external-image.png', { width: 200, height: 100 }]]);
    const r = convertImageSVG(svg, { imageNaturalSizes: sizes });
    const l = r.ir.compositions[0].layers[0] as ImgLayer;

    // 自然 200×100(aspect 2) 显示框 100×100 → meet fw=100,fh=50
    expect(l.localBounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(l.transform.anchor.value).toEqual([50, 25, 0]);
    expect(l.transform.position.value).toEqual([50, 50, 0]);
  });

  it('meet:显式 preserveAspectRatio="none" → 不干预(作者要拉伸)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><image x="0" y="0" width="100" height="100" preserveAspectRatio="none" data-natural-width="200" data-natural-height="100" href="assets/external-image.png"/></svg>`;
    const r = convertImageSVG(svg);
    const l = r.ir.compositions[0].layers[0] as ImgLayer;

    expect(l.localBounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('slice:图比框宽→按高 cover,横向放大且显示框中心不动', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><image x="10" y="20" width="100" height="100" preserveAspectRatio="xMidYMid slice" data-natural-width="200" data-natural-height="100" href="assets/external-image.png"/></svg>`;
    const r = convertImageSVG(svg);
    const l = r.ir.compositions[0].layers[0] as ImgLayer;

    expect(l.localBounds).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(l.transform.anchor.value).toEqual([100, 50, 0]);
    expect(l.transform.position.value).toEqual([60, 70, 0]);
  });

  it('slice:图比框高→按宽 cover,纵向放大且显示框中心不动', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><image x="10" y="20" width="100" height="100" preserveAspectRatio="xMidYMid slice" data-natural-width="100" data-natural-height="200" href="assets/external-image.png"/></svg>`;
    const r = convertImageSVG(svg);
    const l = r.ir.compositions[0].layers[0] as ImgLayer;

    expect(l.localBounds).toEqual({ x: 0, y: 0, width: 100, height: 200 });
    expect(l.transform.anchor.value).toEqual([50, 100, 0]);
    expect(l.transform.position.value).toEqual([60, 70, 0]);
  });
  it('image 的 x/y/width/height 动画会写入 transform', async () => {
    const result = convertImageSVG(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
        <image x="10" y="10" width="20" height="10" href="assets/external-image.png">
          <animate attributeName="x" values="10;30" dur="1s" fill="freeze"/>
          <animate attributeName="width" values="20;40" dur="1s" fill="freeze"/>
        </image>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers[0] as ImgLayer;

    expect(layer.transform.position).toHaveProperty('type', 'keyframed');
    expect(layer.transform.scale).toHaveProperty('type', 'keyframed');
    expect(layer.transform.anchor.value).toEqual([10, 5, 0]);
  });

  it('meet:内嵌 PNG 可直接读取自然尺寸', async () => {
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01,
    ]);
    const href = `data:image/png;base64,${pngHeader.toString('base64')}`;
    const result = convertImageSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><image x="0" y="0" width="100" height="100" href="${href}"/></svg>`);
    const layer = result.ir.compositions[0].layers[0] as ImgLayer;

    expect(layer.localBounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(layer.transform.anchor.value).toEqual([50, 25, 0]);
  });
});

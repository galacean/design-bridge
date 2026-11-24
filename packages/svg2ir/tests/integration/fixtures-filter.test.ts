import { describe, expect, it } from 'vitest';
import { convertSVGToIR } from '@galacean/svg2ir';
import type { IRColor, IRLayer } from '@galacean/animation-ir';

// filter 丢弃策略：替换源型 filter 跳过源元素；引用 SourceGraphic 的增强型 filter 保留源元素。

function getFirstSolidFillColor(layer: IRLayer): IRColor | undefined {
  if (layer.type !== 'shape') { return undefined; }
  const fill = layer.content.shapes[0]?.fills[0];

  return fill?.type === 'solid' ? fill.color : undefined;
}

describe('fixture: filter 丢弃策略', () => {
  it('替换源型 filter(inner-shadow,只 SourceAlpha)→ 跳过元素', async () => {
    // 黑 path + inner-shadow filter(无 SourceGraphic)。SVG 里此 fill=black 不渲染(只渲滤镜产出的内阴影带)。
    // svg2ir 应跳过该 path,否则渲成实心黑色块。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs>
        <filter id="inner"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/><feComposite in2="SourceAlpha" operator="arithmetic" k2="-1" k3="1"/><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 0.8 0"/></filter>
      </defs>
      <rect x="0" y="0" width="200" height="200" fill="#ffffff"/>
      <rect x="20" y="20" width="160" height="160" fill="black" filter="url(#inner)"/>
    </svg>`;
    const r = convertSVGToIR(svg);
    const blackRect = r.ir.compositions[0].layers.find(l => getFirstSolidFillColor(l)?.[0] === 0);

    // 黑 rect 应被跳过(不在 layers),否则会盖住白背景。
    expect(blackRect, '替换源型 filter 的黑 rect 应被跳过,不产 layer').toBeUndefined();
    // 告警应含 filter 丢弃。
    expect(r.warnings.some(w => w.code === 'svg2ir_filter_dropped')).toBe(true);
    // 白背景 rect 保留。
    const whiteRect = r.ir.compositions[0].layers.find(l => getFirstSolidFillColor(l)?.[0] === 1);

    expect(whiteRect, '白背景 rect 应保留').toBeDefined();
  });

  it('增强型 filter(drop-shadow,feMerge 含 SourceGraphic)→ 保留元素', async () => {
    // drop-shadow filter:feGaussianBlur in=SourceAlpha + feMerge(in=SourceGraphic)。
    // SVG 里源图形保留 + 阴影叠加。svg2ir 丢滤镜但应保留源 rect(掉阴影保主体)。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs>
        <filter id="ds"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/><feOffset dx="4" dy="4"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <rect x="20" y="20" width="160" height="160" fill="#1677ff" filter="url(#ds)"/>
    </svg>`;
    const r = convertSVGToIR(svg);
    const blueRect = r.ir.compositions[0].layers.find(l => (getFirstSolidFillColor(l)?.[2] ?? 0) > 0.9);

    // 蓝源 rect 应保留(增强型 filter,丢阴影保主体)。
    expect(blueRect, '增强型 filter 的源 rect 应保留').toBeDefined();
  });

  it('image + feGaussianBlur 无显式 in(默认 SourceGraphic=增强型)→ image 保留', async () => {
    // feGaussianBlur 无显式 in 时默认使用 SourceGraphic；image 保留源内容并报告 filter 降级。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs><filter id="blur"><feGaussianBlur stdDeviation="21"/></filter></defs>
      <rect x="0" y="0" width="200" height="200" fill="#fff"/>
      <image id="bar" x="20" y="20" width="160" height="160" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" filter="url(#blur)"/>
    </svg>`;
    const r = convertSVGToIR(svg);
    const imgLayer = r.ir.compositions[0].layers.find(l => l.type === 'image');

    // image 应保留(image 分支掉 filter 保图,非 1b 跳过)。
    expect(imgLayer, 'image+feGaussianBlur 无显式 in 应保图不跳').toBeDefined();
    // filter 丢弃告警应发(image 分支 warnUnsupportedAttributes)。
    expect(r.warnings.some(w => w.code === 'svg2ir_filter_dropped')).toBe(true);
  });

  it('image + feGaussianBlur 显式 in=SourceGraphic → image 保图(零回退)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs><filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="5"/></filter></defs>
      <rect x="0" y="0" width="200" height="200" fill="#fff"/>
      <image id="img" x="20" y="20" width="160" height="160" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" filter="url(#blur)"/>
    </svg>`;
    const r = convertSVGToIR(svg);
    const imgLayer = r.ir.compositions[0].layers.find(l => l.type === 'image');

    expect(imgLayer, 'image+显式 SG filter 应保图').toBeDefined();
  });

  it('shape + feGaussianBlur 无显式 in(默认 SourceGraphic=增强型)→ 保留源 shape', async () => {
    // feGaussianBlur 无显式 in(SVG 默认 in=SourceGraphic=增强型 blur 源图)。SVG 期望:模糊的红 rect(源可见+blur)。
    // 首个原语默认使用 SourceGraphic，因此保留源 rect 并报告 filter 降级。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs><filter id="blur"><feGaussianBlur stdDeviation="10"/></filter></defs>
      <rect x="0" y="0" width="200" height="200" fill="#fff"/>
      <rect x="40" y="40" width="120" height="120" fill="#CC0000" filter="url(#blur)"/>
    </svg>`;
    const r = convertSVGToIR(svg);
    // 红=#CC0000(0.8,0,0),白=#fff(1,1,1)。找红需绿/蓝≈0。
    const redRect = r.ir.compositions[0].layers.find(l => {
      const color = getFirstSolidFillColor(l);

      return (color?.[0] ?? 0) > 0.7 && (color?.[1] ?? 1) < 0.1;
    });

    expect(redRect, '增强型 blur filter 的源红 rect 应保留(不替源跳过)').toBeDefined();
    expect(r.warnings.some(w => w.code === 'svg2ir_filter_dropped')).toBe(true);
  });

  it('shape + drop-shadow(feOffset in=SourceAlpha 首原语,无 SourceGraphic 合回)→ 替源跳过(SVG 源不显)', async () => {
    // feOffset in=SourceAlpha(显式)→ feGaussianBlur,无 feMerge SourceGraphic 合回 = 替源型 drop-shadow。
    // SVG 渲染:filter result=偏移模糊黑阴影替换源 rect 显示;源红 rect 本不显。svg2ir 替源跳过(防 raw 红块盖背景),正确。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs><filter id="ds"><feOffset in="SourceAlpha" dx="6" dy="6"/><feGaussianBlur stdDeviation="3"/></filter></defs>
      <rect x="0" y="0" width="200" height="200" fill="#fff"/>
      <rect x="40" y="40" width="120" height="120" fill="#CC0000" filter="url(#ds)"/>
    </svg>`;
    const r = convertSVGToIR(svg);
    // 红=#CC0000(0.8,0,0),白=#fff(1,1,1)。找红需绿/蓝≈0(白绿蓝=1)。
    const redRect = r.ir.compositions[0].layers.find(l => {
      const color = getFirstSolidFillColor(l);

      return (color?.[0] ?? 0) > 0.7 && (color?.[1] ?? 1) < 0.1;
    });

    expect(redRect, '替源型 drop-shadow 的源红 rect 应跳过(SVG 源不显,防红块盖背景;只剩白背景)').toBeUndefined();
  });
});

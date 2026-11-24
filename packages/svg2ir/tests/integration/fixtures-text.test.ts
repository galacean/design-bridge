import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertSVGToIR } from '@galacean/svg2ir';
import { SVG2IR_WARNING_CODES } from '../../src/common/types';

// text 解析为 IRTextLayerNode，覆盖字体、颜色、对齐、行距和基础 tspan 几何。

const FIXTURE = path.join(__dirname, '../fixtures/handwritten/text.svg');

describe('fixture: <text> 接入', () => {
  it('resolves em letter-spacing without producing non-finite rich-text transforms', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">
        <text x="200" y="40" font-size="20" letter-spacing="0.2em" text-anchor="middle">SVG</text>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers[0];
    const position = layer.transform!.position as { type: 'static'; value: number[] };

    expect((layer as unknown as { content: { letterSpacing: number } }).content.letterSpacing).toBe(4);
    expect(position.value.every(Number.isFinite)).toBe(true);
  });

  it('3 个 <text> 产 3 个 IRTextLayerNode,正确填 color/font/anchor', async () => {
    const svg = fs.readFileSync(FIXTURE, 'utf-8');
    const r = convertSVGToIR(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(3);
    for (const l of r.ir.compositions[0].layers) { expect(l.type).toBe('text'); }

    const l0 = (r.ir.compositions[0].layers[0] as { content: { text: string; fontAssetId: string; fontSize: number; textAlign: string; color: number[] } }).content;

    expect(l0.text).toBe('Hello GE');
    expect(r.ir.assets.find(asset => asset.id === l0.fontAssetId)).toMatchObject({
      type: 'font',
      family: 'Arial',
      style: 'normal',
      weight: 700,
      source: { kind: 'system' },
    });
    expect(l0.fontSize).toBe(32);
    expect(l0.textAlign).toBe('left'); // text-anchor=start
    // #1677ff
    expect(l0.color[0]).toBeCloseTo(0.0863, 4);
    expect(l0.color[2]).toBeCloseTo(1, 4);
  });

  it('text-anchor 映射: middle→center', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const l1 = (r.ir.compositions[0].layers[1] as { content: { textAlign: string } }).content;

    expect(l1.textAlign).toBe('center'); // text-anchor=middle
  });

  it('tspan 文本拼接', async () => {
    const r = convertSVGToIR(fs.readFileSync(FIXTURE, 'utf-8'));
    const l2 = (r.ir.compositions[0].layers[2] as { content: { text: string } }).content;

    expect(l2.text).toBe('多段1多段2');
  });

  it('空 <text> 跳过(无 warn)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="10" y="20"></text></svg>`;
    const r = convertSVGToIR(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('不同 y 的多 tspan 按多行分行', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
      <text font-size="40" fill="#000"><tspan y="0">上行</tspan><tspan y="60">下行</tspan></text></svg>`;
    const r = convertSVGToIR(svg);
    const t = (r.ir.compositions[0].layers[0] as { content: { text: string } }).content;

    expect(t.text).toBe('上行\n下行'); // 不同 y = 真多行
  });

  it('同 y 合并 + 不同 y 新行 混合形态不乱', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
      <text font-size="40" fill="#000"><tspan y="0">A</tspan><tspan y="0">B</tspan><tspan y="60">C</tspan></text></svg>`;
    const r = convertSVGToIR(svg);
    const t = (r.ir.compositions[0].layers[0] as { content: { text: string } }).content;

    expect(t.text).toBe('AB\nC'); // 前 2 个 y=0 合并一行,第 3 个 y=60 开新行
  });

  it('text-anchor=middle + tspan x: cx 使用首 tspan x', async () => {
    // SVG <text transform=translate(370,0) text-anchor=middle> 无 x 属性,<tspan x=380> 是字形锚点。
    // <text> 缺少 x 时使用首个 tspan 的 x 作为横向锚点。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><text id="m1" text-anchor="middle" transform="matrix(1,0,0,1,370,0)" font-size="100" fill="#000"><tspan x="380" y="0">无油低脂</tspan></text></svg>`;
    const r = convertSVGToIR(svg);
    const pos = (r.ir.compositions[0].layers[0] as { transform: { position: { value: number[] } } }).transform.position.value;

    expect(pos[0]).toBeCloseTo(750, 1); // cx=380(首 tspan x) + transform.tx=370
  });

  it('多行 tspan 的绝对 x/y 叠加单值 dx/dy(不把第二行偏移静默丢掉)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700">
      <text x="500" y="240" font-size="200" letter-spacing="50" text-anchor="middle" fill="#000">
        <tspan x="300" y="240">新品</tspan><tspan x="700" y="480" dx="80" dy="40">首发</tspan>
      </text></svg>`;
    const measureText = (fontDesc: string, text: string) => {
      const px = parseFloat((fontDesc.match(/(\d+(?:\.\d+)?)px/) ?? [])[1] ?? '16');

      return { width: px * [...text].length, fontBoundingBoxAscent: px * 0.8, fontBoundingBoxDescent: px * 0.2 };
    };
    const r = convertSVGToIR(svg, { measureText });
    const textLayers = r.ir.compositions[0].layers.filter(l => l.type === 'text') as Array<{ content: { text: string }; transform: { position: { value: number[] } } }>;
    const first = textLayers.find(l => l.content.text === '新品')!;
    const second = textLayers.find(l => l.content.text === '首发')!;

    expect(textLayers).toHaveLength(2);
    expect(second.transform.position.value[0] - first.transform.position.value[0]).toBeCloseTo(480, 4); // (700+80)-300
    expect(second.transform.position.value[1] - first.transform.position.value[1]).toBeCloseTo(280, 4); // (480+40)-240
  });

  it('<text> 无 y + tspan y 非 0:cy 用首 tspan y 补', async () => {
    // <text> 无 y,baseline 写在 tspan.y。y 优先级 <text>.y → firstTspanY → 0。单行 tspan y=53。
    // 单行无 line-height 属性时使用 fontSize 作为默认行高。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><text id="t1" font-size="50" fill="#000"><tspan y="53" x="0">此处填写主标题</tspan></text></svg>`;
    const r = convertSVGToIR(svg);
    const pos = (r.ir.compositions[0].layers[0] as { transform: { position: { value: number[] } } }).transform.position.value;
    const F = 50, lh = F, estH = F, asc = 0.8 * F, desc = 0.2 * F, baselineYGe = asc + (lh - asc - desc) / 2;

    expect(pos[1]).toBeCloseTo(53 + estH / 2 - baselineYGe, 1); // = 38
  });

  it('dominant-baseline=hanging 使用 Canvas hangingBaseline,不误用含 line-gap 的 asc', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <text x="20" y="100" font-family="sans-serif" font-size="100" fill="#000" dominant-baseline="hanging">AB</text>
    </svg>`;
    const measureText = (fontDesc: string) => {
      const size = Number(fontDesc.match(/([\d.]+)px/)?.[1] ?? 10);

      return {
        width: 10,
        // GE layout metrics are read at 10px and scaled by the plugin; the SVG
        // baseline metric is read at the actual font size because browser font
        // metrics are quantized differently at 10px and 100px.
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
        hangingBaseline: size === 10 ? 6 : 70,
      };
    };
    const r = convertSVGToIR(svg, { measureText });
    const pos = (r.ir.compositions[0].layers[0] as { transform: { position: { value: number[] } } }).transform.position.value;

    // At font-size=100, asc=80, desc=20, lineHeight=100. The size-specific
    // SVG hanging baseline is 70px below alphabetic: cy=100+70+50-80=140.
    expect(pos[1]).toBeCloseTo(140, 1);
  });

  it('dominant-baseline 的 SVG 锚点使用实际字号 font box metric', async () => {
    const measureText = (fontDesc: string) => {
      const size = Number(fontDesc.match(/([\d.]+)px/)?.[1] ?? 10);

      return size === 10
        ? { width: 10, fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3, actualBoundingBoxAscent: 5, hangingBaseline: 8.8 }
        : { width: 10, fontBoundingBoxAscent: 212, fontBoundingBoxDescent: 68, actualBoundingBoxAscent: 103.4, hangingBaseline: 169.6 };
    };
    const expected: Record<string, number> = {
      central: 232,
      'text-before-edge': 372,
      'text-after-edge': 92,
      ideographic: 92,
    };

    for (const [baseline, expectedCy] of Object.entries(expected)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
        <text x="20" y="240" font-family="sans-serif" font-size="200" fill="#000" dominant-baseline="${baseline}">AB</text>
      </svg>`;
      const r = convertSVGToIR(svg, { measureText });
      const pos = (r.ir.compositions[0].layers[0] as { transform: { position: { value: number[] } } }).transform.position.value;

      expect(pos[1]).toBeCloseTo(expectedCy, 1);
    }
  });

  it('text 不静默:渐变填充→TEXT_GRADIENT_FILL_FLATTENED;filter→FILTER_DROPPED;不重复 warn', async () => {
    // IR 文本只保留单色填充，filter 也没有对应 IR 字段；两者都要记录 warning。
    // 渐变带 gradientTransform:文字渐变整体降级单色 → gradientTransform 被 flatten 吸收,只发 1 条 flatten,
    // 渐变已 flatten，保留一条 warning。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160">
      <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="0" gradientTransform="translate(0.5,0) scale(2,1)"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
      <text font-family="sans-serif" font-size="40" fill="url(#g1)"><tspan y="40">渐变字</tspan></text>
      <text font-family="sans-serif" font-size="40" fill="#000" filter="url(#x)"><tspan y="110">滤镜字</tspan></text>
      <text font-family="sans-serif" font-size="40" fill="#000"><tspan y="150">纯色字</tspan></text></svg>`;
    const r = convertSVGToIR(svg);
    const flat = r.warnings.filter(w => w.code === SVG2IR_WARNING_CODES.TEXT_GRADIENT_FILL_FLATTENED);

    expect(flat.length).toBe(1); // 渐变文字只 1 条 flatten
    expect(r.warnings.some(w => w.code === SVG2IR_WARNING_CODES.FILTER_DROPPED)).toBe(true);
    // text 渐变已 flatten，只保留一条 warning
    expect(r.warnings.some(w => w.code === SVG2IR_WARNING_CODES.ELEMENT_DROPPED && w.message.includes('gradientTransform'))).toBe(false);
  });

  it('per-tspan 渐变 fill 也发 TEXT_GRADIENT_FILL_FLATTENED(不静默)', async () => {
    // <text> 纯色但 tspan fill=url(渐变):parse 塌中点色进 <color>(渲染对),warn 不能漏(对齐 <text> 级语义)。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
      <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
      <text font-family="sans-serif" font-size="40" fill="#000"><tspan y="40" fill="url(#g1)">渐变字</tspan></text></svg>`;
    const r = convertSVGToIR(svg);
    const flat = r.warnings.filter(w => w.code === SVG2IR_WARNING_CODES.TEXT_GRADIENT_FILL_FLATTENED);

    expect(flat.length).toBe(1); // per-tspan 渐变也 warn(不静默)
  });

  it('同行多 tspan + dx(可处理):拆成 N 个独立 IR 文本层,各 position.x 含累加 dx', async () => {
    // 注入 mock measureText 触发拆段路径。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
      <text id="t1" font-size="100" fill="#000" transform="matrix(1,0,0,1,40,150)">
        <tspan fill="#482B17" y="0">耐磨</tspan><tspan fill="#DE1E00" y="0" dx="31.5">不沾</tspan>
      </text></svg>`;
    const measureText = (fontDesc: string, text: string) => {
      // 简单系数:每字 = fontSize(CJK 1.0em),从 fontDesc 取 fontSize。
      const px = parseFloat((fontDesc.match(/(\d+\.?\d*)px/) ?? [])[1] ?? '16');

      return { width: px * [...text].length, fontBoundingBoxAscent: px * 0.8, fontBoundingBoxDescent: px * 0.2 };
    };
    const r = convertSVGToIR(svg, { measureText });
    const textLayers = r.ir.compositions[0].layers.filter(l => (l as { type?: string }).type === 'text');

    expect(textLayers.length).toBe(2); // 拆成 2 段(耐磨 / 不沾)
    // 按 content 找到对应文本段再比较位置，避免依赖拆段实现的局部顺序。
    const findByContent = (c: string) => textLayers.find(l => (l as { content: { text: string } }).content.text === c) as unknown as { transform: { position: { value: number[] } } };
    const pos耐 = findByContent('耐磨').transform.position.value;
    const pos不 = findByContent('不沾').transform.position.value;

    expect(pos不[0]).toBeGreaterThan(pos耐[0]); // 不沾(dx=31.5)在耐磨右侧
    expect(pos不[0] - pos耐[0]).toBeGreaterThan(31); // 间距含 dx(应 >31.5)
  });

  it('同行多 tspan + dx 列表/百分比/负其中不支持形态:不拆走单 comp 或 ge-capability', async () => {
    // dx 列表/百分比是非 px 不可处理形态,isDxUnsupported 命中 → 不拆(走单 comp)。负 dx 单数值仍可拆(leftEdge 累加负)。
    const measureText = (fontDesc: string, text: string) => {
      const px = parseFloat((fontDesc.match(/(\d+\.?\d*)px/) ?? [])[1] ?? '16');

      return { width: px * [...text].length, fontBoundingBoxAscent: px * 0.8, fontBoundingBoxDescent: px * 0.2 };
    };
    // dx 列表 "10 20":不拆,走单 comp。
    const svgList = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
      <text id="t1" font-size="100" fill="#000"><tspan y="0">A</tspan><tspan y="0" dx="10 20">B</tspan></text></svg>`;
    const rList = convertSVGToIR(svgList, { measureText });
    const listLayers = rList.ir.compositions[0].layers.filter(l => (l as { type?: string }).type === 'text');

    expect(listLayers.length).toBe(1); // dx 列表不拆,单 comp
    // dx 百分比 "50%":不拆(isDxUnsupported 命中 %),parseFloat 不会误读成 50px。
    const svgPct = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
      <text id="t1" font-size="100" fill="#000"><tspan y="0">A</tspan><tspan y="0" dx="50%">B</tspan></text></svg>`;
    const rPct = convertSVGToIR(svgPct, { measureText });
    const pctLayers = rPct.ir.compositions[0].layers.filter(l => (l as { type?: string }).type === 'text');

    expect(pctLayers.length).toBe(1); // dx 百分比不拆
  });

  it('无 measureText 回调:有 dx 也不拆(走单 comp,Node 环境退路)', async () => {
    // 无 measureText(Node 测试默认)时 canSplit=false,有 dx 也走单 comp(原空格烘焙路径,但无 measureText 不烘焙)。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
      <text id="t1" font-size="100" fill="#000"><tspan y="0">A</tspan><tspan y="0" dx="31.5">B</tspan></text></svg>`;
    const r = convertSVGToIR(svg); // 无 measureText
    const textLayers = r.ir.compositions[0].layers.filter(l => (l as { type?: string }).type === 'text');

    expect(textLayers.length).toBe(1); // 无回调不拆,单 comp
  });
});

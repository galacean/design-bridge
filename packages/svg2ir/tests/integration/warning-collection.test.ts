import { describe, expect, it } from 'vitest';
import { convertSVGToIR } from '@galacean/svg2ir';
import { SVG2IR_WARNING_CODES } from '../../src/common/types';
import { SVGConverterError } from '../../src/common/errors';
import type { IRRectangleShape } from '@galacean/animation-ir';

// 覆盖声明区过滤、实例展开、虚线合成和不支持特性的 warning 语义。

describe('warning 收集与静默语义', () => {
  it('defs 内几何不进 layers(silent skip)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs><rect id="r" x="10" y="10" width="50" height="50" fill="#000"/></defs>
      <rect x="100" y="100" width="50" height="50" fill="#1677ff"/>
    </svg>`;
    const r = convertSVGToIR(svg);

    // defs 内 rect 是声明不渲染,只剩顶层 rect → 1 个图层。
    expect(r.ir.compositions[0].layers).toHaveLength(1);
    expect(((r.ir.compositions[0].layers[0]) as unknown as { content: { shapes: Array<{ primitiveType: string }> } }).content.shapes[0].primitiveType).toBe('rectangle');
  });

  it('clipPath 内几何不进 layers', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
      <defs><clipPath id="cp"><circle cx="150" cy="150" r="80"/></clipPath></defs>
      <rect x="0" y="0" width="300" height="300" fill="#1677ff" clip-path="url(#cp)"/>
    </svg>`;
    const r = convertSVGToIR(svg);

    // clipPath 内 circle 是裁剪定义,不该成实体图层;只剩被裁 rect。
    expect(r.ir.compositions[0].layers).toHaveLength(1);
    expect(((r.ir.compositions[0].layers[0]) as unknown as { content: { shapes: Array<{ primitiveType: string }> } }).content.shapes[0].primitiveType).toBe('rectangle');
  });

  it('use 展开成实例层(deflatten)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
      <defs><polygon id="star" points="150,50 180,140 100,80 200,80 120,140" fill="#faad14"/></defs>
      <use href="#star" x="0" y="0"/>
    </svg>`;
    const r = convertSVGToIR(svg);

    // use 展开:复制 star geometry 成 1 个实例层;defs 内 polygon 声明不渲(不进 layers)。
    expect(r.ir.compositions[0].layers).toHaveLength(1);
    expect(r.ir.compositions[0].layers[0].type).toBe('shape');
    expect((r.ir.compositions[0].layers[0] as unknown as { content: { shapes: Array<{ primitiveType: string }> } }).content.shapes[0].primitiveType).toBe('custom');
    // use 展开成功,不发 ELEMENT_DROPPED warning。
    expect(r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.ELEMENT_DROPPED && w.message.includes('use'))).toBeUndefined();
  });

  it('stroke-dasharray 直线 open 子路径:合成成多段虚线 customPath + 不发降级 warn(视觉无差)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">
      <line x1="20" y1="50" x2="280" y2="50" stroke="#722ed1" stroke-width="4" stroke-dasharray="10 5"/>
    </svg>`;
    const r = convertSVGToIR(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(1); // 单形状层
    const shape = (r.ir.compositions[0].layers[0] as unknown as { content: { shapes: Array<{ primitiveType: string; customPaths?: Array<{ points: unknown[] }> }> } }).content.shapes[0];

    expect(shape.primitiveType).toBe('custom');
    // pattern 15,dash [10,5]:on=[0,10],[15,25]... 总长 260 → 18 段(最后一 [255,265] 裁 [255,260])
    expect(shape.customPaths!.length).toBeGreaterThan(1);
    // 直线 dash 已精确合成,视觉无差 → 不发 STROKE_DASH_DROPPED(否则误报)
    expect(r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.STROKE_DASH_DROPPED)).toBeUndefined();
  });

  it('stroke-dasharray 闭合 polygon(超界不可合成):降级实线 + 发 STROKE_DASH_DROPPED warning', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">
      <polygon points="20,30 280,30 280,70 20,70" fill="none" stroke="#722ed1" stroke-width="4" stroke-dasharray="10 5"/>
    </svg>`;
    const r = convertSVGToIR(svg);

    expect(r.ir.compositions[0].layers).toHaveLength(1);
    const dashWarn = r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.STROKE_DASH_DROPPED);

    expect(dashWarn).toBeDefined();
    expect(dashWarn?.message).toContain('dasharray');
  });

  it('filter 属性丢弃 + 发 FILTER_DROPPED warning', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect x="10" y="10" width="100" height="80" fill="#1677ff" filter="url(#blur)"/>
    </svg>`;
    const r = convertSVGToIR(svg);

    const filterWarn = r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.FILTER_DROPPED);

    expect(filterWarn).toBeDefined();
  });

  it('<text> stroke 描边丢弃(策略富文本无 outline 入口)+ 发 TEXT_STROKE_DROPPED warning', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <text x="200" y="120" font-size="80" fill="#111" stroke="#CC0000" stroke-width="8" paint-order="stroke fill">AB</text>
    </svg>`;
    const r = convertSVGToIR(svg);

    const strokeWarn = r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.TEXT_STROKE_DROPPED);

    expect(strokeWarn).toBeDefined();
    expect(strokeWarn?.message).toContain('stroke');
    // paint-order 顺序随 stroke 一起丢,message 显式提及
    expect(strokeWarn?.message).toContain('paint-order');
  });

  it('<text> text-decoration 丢弃(isUnderline 暂时无效 + markup 无装饰标签)+ 发 TEXT_DECORATION_DROPPED warning', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <text x="200" y="120" font-size="80" fill="#111" text-decoration="underline line-through">AB</text>
    </svg>`;
    const r = convertSVGToIR(svg);

    const decWarn = r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.TEXT_DECORATION_DROPPED);

    expect(decWarn).toBeDefined();
    expect(decWarn?.message).toContain('text-decoration');
  });

  it('<text> stroke/text-decoration 缺省不误报(纯 fill 文本无 stroke 无装饰 → 不发对应 warn)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <text x="200" y="120" font-size="80" fill="#111">AB</text>
    </svg>`;
    const r = convertSVGToIR(svg);

    expect(r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.TEXT_STROKE_DROPPED)).toBeUndefined();
    expect(r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.TEXT_DECORATION_DROPPED)).toBeUndefined();
  });

  it('per-tspan stroke 也触发 TEXT_STROKE_DROPPED(<text> 级缺省但 tspan 带 stroke)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
      <text x="200" y="120" font-size="80"><tspan fill="#111" stroke="#CC0000">AB</tspan></text>
    </svg>`;
    const r = convertSVGToIR(svg);

    expect(r.warnings.find(w => w.code === SVG2IR_WARNING_CODES.TEXT_STROKE_DROPPED)).toBeDefined();
  });

  it('pure 形状无 warning(已在 pure-shapes fixture 锁定,此处复核)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect x="10" y="10" width="80" height="60" fill="#1677ff"/>
      <circle cx="150" cy="150" r="30" fill="#52c41a"/>
    </svg>`;
    const r = convertSVGToIR(svg);

    expect(r.warnings).toHaveLength(0);
    expect(r.ir.compositions[0].layers).toHaveLength(2);
  });

  it('strict 模式:降级项升级成抛错(svg-layout throwOrRecordError 范式)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <use href="#x"/>
    </svg>`;

    expect(() => convertSVGToIR(svg, { strict: true })).toThrowError(SVGConverterError);
  });

  it('clip/mask 非 userSpace 语义与组级 clip-path 显式 warning', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs>
        <clipPath id="box" clipPathUnits="objectBoundingBox">
          <path fill-rule="evenodd" d="M0 0 H1 V1 H0 Z"/>
        </clipPath>
        <mask id="fade" maskContentUnits="objectBoundingBox" maskUnits="userSpaceOnUse"
          x="0" y="0" width="100" height="100" mask-type="luminance">
          <rect width="1" height="1"/>
        </mask>
      </defs>
      <g clip-path="url(#box)"><rect width="100" height="100" fill="red"/></g>
      <rect width="100" height="100" fill="blue" mask="url(#fade)"/>
    </svg>`;
    const result = convertSVGToIR(svg);
    const codes = result.warnings.map(warning => warning.code);

    expect(codes).toContain(SVG2IR_WARNING_CODES.CLIP_PATH_UNITS_DROPPED);
    expect(codes).toContain(SVG2IR_WARNING_CODES.CLIP_RULE_DROPPED);
    expect(codes).toContain(SVG2IR_WARNING_CODES.GROUP_CLIP_PATH_DROPPED);
    expect(codes).toContain(SVG2IR_WARNING_CODES.MASK_CONTENT_UNITS_DROPPED);
    expect(codes).toContain(SVG2IR_WARNING_CODES.MASK_REGION_DROPPED);
    expect(codes).toContain(SVG2IR_WARNING_CODES.MASK_TYPE_DROPPED);
  });

  it('clip/mask 非 userSpace 语义在 strict 模式抛结构化错误', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <defs><clipPath id="box" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath></defs>
      <rect width="100" height="100" clip-path="url(#box)"/>
    </svg>`;

    let error: unknown;

    try {
      convertSVGToIR(svg, { strict: true });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(SVGConverterError);
    expect(error).toMatchObject({
      name: 'SVGConverterError',
      details: { warningCode: SVG2IR_WARNING_CODES.CLIP_PATH_UNITS_DROPPED },
    });
  });

  it('未引用的 clip/mask 定义不产生降级 warning，也不触发 strict 失败', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <defs>
        <clipPath id="unused-box" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath>
        <mask id="unused-mask" maskContentUnits="objectBoundingBox" maskUnits="userSpaceOnUse" x="0" width="10" mask-type="luminance"><rect width="1" height="1"/></mask>
      </defs>
      <rect width="100" height="100" fill="red"/>
    </svg>`;
    const result = convertSVGToIR(svg, { strict: true });
    const codes = result.warnings.map(warning => warning.code);

    expect(codes).not.toContain(SVG2IR_WARNING_CODES.CLIP_PATH_UNITS_DROPPED);
    expect(codes).not.toContain(SVG2IR_WARNING_CODES.MASK_CONTENT_UNITS_DROPPED);
    expect(codes).not.toContain(SVG2IR_WARNING_CODES.MASK_REGION_DROPPED);
    expect(codes).not.toContain(SVG2IR_WARNING_CODES.MASK_TYPE_DROPPED);
  });

  it('rect rx 超过短边一半时钳制到局部几何上界', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect x="10" y="10" width="380" height="380" rx="200" fill="#1677ff"/></svg>`;
    const r = convertSVGToIR(svg);

    expect((((r.ir.compositions[0].layers[0]) as unknown as { content: { shapes: Array<{ primitiveType: string }> } }).content.shapes[0] as IRRectangleShape).cornerRadius).toBe(190);
  });

  it('rect ry 兜底(svg 可只给 ry)', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="10" y="10" width="100" height="50" ry="15" fill="#000"/></svg>`;
    const r = convertSVGToIR(svg);

    // IR cornerRadius 保留局部像素。
    expect((((r.ir.compositions[0].layers[0]) as unknown as { content: { shapes: Array<{ primitiveType: string }> } }).content.shapes[0] as IRRectangleShape).cornerRadius).toBe(15);
  });
});

import { describe, expect, it } from 'vitest';
import EditableSVG from '../../../src/parse-svg/node';
import { resolveGradientPaint } from '../../../src/svg2ir/converter/paint/resolve-gradient';
import { IRPaintType } from '@galacean/animation-ir';

// parser 层单测:锁死 SVG 渐变 → IRGradientShapePaintData。
// 关键不变量:起止点必须转成相对 shape bbox 的 0-1 UV(Effects Runtime shader 用 UV 比对 _StartPoint/_EndPoint,
// 覆盖 userSpaceOnUse 的大小写归一化和 UV 坐标转换。
function es (svg: string) { return new EditableSVG(svg, {}); }

const BBOX = { minX: 20, minY: 40, width: 360, height: 120 };

describe('resolveGradientPaint', () => {
  it('非 url() 返回 null(纯色交由 mapSVGColorToIRColor)', () => {
    expect(resolveGradientPaint(es('<svg></svg>'), '#1677ff', 1, BBOX)).toBeNull();
    expect(resolveGradientPaint(es('<svg></svg>'), 'none', 1, BBOX)).toBeNull();
  });

  it('找不到 def 返回 null', () => {
    expect(resolveGradientPaint(es('<svg></svg>'), 'url(#missing)', 1, BBOX)).toBeNull();
  });

  it('linear userSpaceOnUse:绝对坐标 → 相对 bbox 的 0-1 UV', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><defs>
      <linearGradient id="g" x1="0" y1="0" x2="400" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#1677ff"/><stop offset="1" stop-color="#eb2f96"/>
      </linearGradient></defs></svg>`;
    const g = resolveGradientPaint(es(svg), 'url(#g)', 1, BBOX)!;

    expect(g.type).toBe(IRPaintType.LinearGradient);
    // x1=0 → (0-20)/360 = -0.0556; y1=0 → 1-(0-40)/120 = 1.3333(toUV 翻 Y 对齐 shader uv0 y 朝上)
    expect(g.gradientStart[0]).toBeCloseTo(-1 / 18, 6);
    expect(g.gradientStart[1]).toBeCloseTo(4 / 3, 6);
    // x2=400 → (400-20)/360 = 1.0556; y2=0 → 1.3333
    expect(g.gradientEnd[0]).toBeCloseTo(19 / 18, 6);
    expect(g.gradientEnd[1]).toBeCloseTo(4 / 3, 6);
  });

  it('linear 默认 objectBoundingBox:0-1 → bbox 绝对 → UV', () => {
    // 无 gradientUnits,默认 objectBoundingBox;x1=0 y1=0 x2=1 y2=0(水平左→右)
    // 转 bbox 绝对:(20,40)→(380,40);再转 UV(翻 Y 朝上):start (0,0) → (0,1),end (1,0) → (1,1)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><defs>
      <linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs></svg>`;
    const g = resolveGradientPaint(es(svg), 'url(#g)', 1, BBOX)!;

    expect(g.gradientStart).toEqual([0, 1]);
    expect(g.gradientEnd).toEqual([1, 1]);
  });

  it('stops 解析 offset/stop-color/stop-opacity → [pos,r,g,b,a] 0-1', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><defs>
      <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="100">
        <stop offset="0" stop-color="#1677ff"/>
        <stop offset="1" stop-color="#eb2f96" stop-opacity="0.5"/>
      </linearGradient></defs></svg>`;
    const g = resolveGradientPaint(es(svg), 'url(#g)', 1, BBOX)!;

    expect(g.gradientStops).toHaveLength(2);
    expect(g.gradientStops[0]).toEqual([0, 0.08627450980392157, 0.4666666666666667, 1, 1]);
    // stop-opacity 0.5 乘进 alpha
    expect(g.gradientStops[1][0]).toBe(1);
    expect(g.gradientStops[1][4]).toBeCloseTo(0.5, 6);
  });

  it('radial: startPoint=圆心(cx,cy) UV,endPoint=圆心+r 边界点(半径 r 编进模长)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><defs>
      <radialGradient id="r" cx="200" cy="100" r="50" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
      </radialGradient></defs></svg>`;
    const g = resolveGradientPaint(es(svg), 'url(#r)', 1, BBOX)!;

    expect(g.type).toBe(IRPaintType.RadialGradient);
    // BBOX={minX:20,minY:40,width:360,height:120}。cx=200 → UV=(200-20)/360=0.5;cy=100 → 1-(100-40)/120=0.5(翻 Y 后仍 0.5,正好居中)。
    // GE shader radial: startPoint=圆心,endPoint=圆心+r 边界点=end=(cx+r,cy)。
    expect(g.gradientStart[0]).toBeCloseTo(0.5, 6); // 圆心 cx
    expect(g.gradientStart[1]).toBeCloseTo(0.5, 6); // 圆心 cy(翻 Y 后 1-0.5=0.5)
    // endPoint = (cx+r, cy) → (250-20)/360 = 0.6389; cy 同 0.5。半径 r=50 编进 |end-start|。
    expect(g.gradientEnd[0]).toBeCloseTo((200 + 50 - 20) / 360, 6);
    expect(g.gradientEnd[1]).toBeCloseTo(1 - (100 - 40) / 120, 6); // == 0.5(垂直方向也圆心,GE 各向同性真径向)
  });
});

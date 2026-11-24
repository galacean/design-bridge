import { describe, expect, it } from 'vitest';
import EditableSVG from '../../../src/parse-svg/node';
import { parseCustomPath, parseEllipse, parseRect } from '../../../src/svg2ir/converter/shape/parse-shape-primitives';
import { convertCircularAnnulusToEllipseStroke } from '../../../src/svg2ir/converter/shape/convert-annulus';
import { IRShapePrimitiveType } from '@galacean/animation-ir';
import type { IRSolidPaint } from '@galacean/animation-ir';

// parser 层单测:锁死 SVG 基本形状 → IRShape 的几何中心 position、
// customPath 顶点相对中心(对齐 ge-ir shape item 局部坐标)、
// fills/cornerRadius/circle 等价。经 Node 入口(vitest setup)。
function make (svg: string) {
  const es = new EditableSVG(svg, {});

  return { es, el: es.svg.find('*')[0] };
}

describe('parseRect', () => {
  it('position=几何中心,填 width/height/cornerRadius/fills', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><rect x="20" y="40" width="360" height="120" fill="#1677ff" rx="16"/></svg>');
    const s = parseRect(es, el);

    expect(s.primitiveType).toBe(IRShapePrimitiveType.Rectangle);
    expect(s.position).toEqual([200, 100]);
    expect(s.width).toBe(360);
    expect(s.height).toBe(120);
    // IR cornerRadius 使用局部像素。
    expect(s.cornerRadius).toBe(16);
    expect(s.fills).toHaveLength(1);
    expect(s.fills[0]).toMatchObject({ type: 'solid' });
    expect((s.fills[0] as IRSolidPaint).color).toEqual([0.08627450980392157, 0.4666666666666667, 1, 1]);
  });

  it('胶囊:rx=h/2 → cornerRadius=52(局部像素)', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="331" height="104" rx="52" fill="#1677ff"/></svg>');
    const s = parseRect(es, el);

    expect(s.height).toBe(104);
    expect(s.cornerRadius).toBe(52); // rx=52=h/2 时为完整半圆。
  });

  it('rx>halfMin 钳到短边一半', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="380" height="380" rx="200" fill="#1677ff"/></svg>');
    const s = parseRect(es, el);

    expect(s.cornerRadius).toBe(190);
  });

  it('无 rx 不填 cornerRadius', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10" fill="#000"/></svg>');
    const s = parseRect(es, el);

    expect(s.cornerRadius).toBeUndefined();
  });
});

describe('parseEllipse', () => {
  it('没有显式 fill 时使用 SVG 规范默认黑色,stroke 仍默认为 none', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3"/></svg>');
    const s = parseEllipse(es, el, true);

    expect(s.fills).toHaveLength(1);
    expect((s.fills[0] as IRSolidPaint).color).toEqual([0, 0, 0, 1]);
    expect(s.strokes).toEqual([]);
  });

  it('circle:rx=ry=r,position=(cx,cy)', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="300" cy="80" r="50" fill="#52c41a"/></svg>');
    const s = parseEllipse(es, el, true);

    expect(s.primitiveType).toBe(IRShapePrimitiveType.Ellipse);
    expect(s.position).toEqual([300, 80]);
    expect(s.xRadius).toBe(50);
    expect(s.yRadius).toBe(50);
  });

  it('ellipse:rx≠ry', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><ellipse cx="200" cy="150" rx="170" ry="110"/></svg>');
    const s = parseEllipse(es, el, false);

    expect(s.xRadius).toBe(170);
    expect(s.yRadius).toBe(110);
  });
});

describe('parseCustomPath', () => {
  it('polygon 顶点相对几何中心', () => {
    // 顶点 (0,0)(100,0)(100,100),bbox 中心 (50,50)。
    // ge-ir 把 customPath 顶点当相对 shape item(position=中心)的偏移,故顶点须减中心。
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><polygon points="0 0 100 0 100 100" fill="#ff7a45"/></svg>');
    const s = parseCustomPath(es, el, 'polygon') ;

    expect(s).not.toBeNull();
    expect(s!.primitiveType).toBe(IRShapePrimitiveType.Custom);
    expect(s!.position).toEqual([50, 50]);
    const pts = s!.customPaths[0].points;

    expect(pts).toEqual([{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }]);
    expect(s!.customPaths[0].closed).toBe(true);
  });

  it('polyline 不闭合', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><polyline points="0 0 50 50" fill="none" stroke="#000"/></svg>');
    const s = parseCustomPath(es, el, 'polyline') ;

    expect(s!.customPaths[0].closed).toBe(false);
    expect(s!.strokes).toHaveLength(1);
  });

  it('line → 两点 path', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="100" y2="0" stroke="#000"/></svg>');
    const s = parseCustomPath(es, el, 'line') ;

    expect(s!.customPaths[0].points).toHaveLength(2);
    expect(s!.customPaths[0].points[0]).toMatchObject({ x: -50, y: 0 });
    expect(s!.customPaths[0].points[1]).toMatchObject({ x: 50, y: 0 });
  });

  it('fill-only 复合 path(外框+内洞)缝合成单条路径,避免 GE 把洞也填充', () => {
    // 复现 0HVIZR 绿色边框 worst case:外矩形顺时针,内矩形逆时针(y-down)。
    const d = 'M1500,0 L1500,362 L0,362 L0,0 L1500,0 Z M1480,20 L20,20 L20,342 L1480,342 L1480,20 Z';
    const { es, el } = make(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="#1d9b29"/></svg>`);
    const s = parseCustomPath(es, el, 'path') ;

    expect(s).not.toBeNull();
    expect(s!.primitiveType).toBe(IRShapePrimitiveType.Custom);
    // 合并后应只剩一个自定义形状,GE 会把它当作一个整体做 odd 三角化。
    expect(s!.customPaths).toHaveLength(1);

    const path = s!.customPaths[0];

    expect(path.closed).toBe(true);
    // 原始 path 在 Z 前显式重复了闭合点,所以外框 5 点、内洞 5 点;
    // 合并后加 1 个外框起点副本 + 1 个桥接内洞起点 = 12。
    expect(path.points).toHaveLength(12);

    // 合并后的多边形带积(odd 规则下)应等于外框面积 - 内洞面积 = 72,880。
    expect(Math.abs(polygonArea(path.points) - 72_880)).toBeLessThan(1e-6);
  });

  it('完整同心圆环使用 GE 原生 ellipse stroke,避免小尺寸 custom hole 三角化误差', () => {
    const d = 'M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,20a9,9,0,1,1,9-9A9,9,0,0,1,12,21Z';
    const { es, el } = make(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="#000"/></svg>`);
    const custom = parseCustomPath(es, el, 'path');
    const s = custom == null ? null : convertCircularAnnulusToEllipseStroke(es, el, custom);

    expect(s).not.toBeNull();
    expect(s!.primitiveType).toBe(IRShapePrimitiveType.Ellipse);
    expect(s!.position).toEqual([12, 12]);
    expect(s!.fills).toHaveLength(0);
    expect(s!.strokes).toHaveLength(1);
    expect(s!.xRadius).toBeCloseTo(10, 5);
    expect(s!.yRadius).toBeCloseTo(10, 5);
    expect(s!.strokes[0]?.width).toBeCloseTo(2, 5);
  });

  it('有描边的复合 path 不合并,保留原 sub-path 描边语义', () => {
    const d = 'M0,0 L100,0 L100,100 L0,100 Z M20,20 L80,20 L80,80 L20,80 Z';
    const { es, el } = make(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="red" stroke="blue"/></svg>`);
    const s = parseCustomPath(es, el, 'path') ;

    expect(s!.customPaths).toHaveLength(2);
  });

  it('nonzero 同向嵌套轮廓不桥接,避免 GE odd triangulation 误挖洞', () => {
    const d = 'M0,0 L100,0 L100,100 L0,100 Z M20,20 L80,20 L80,80 L20,80 Z';
    const { es, el } = make(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="red" fill-rule="nonzero"/></svg>`);
    const s = parseCustomPath(es, el, 'path');

    expect(s!.customPaths).toHaveLength(2);
  });

});

// stroke-dasharray 虚线合成:GE 无 native dash,parse-shape 把直线 open 子路径按 on-区间
// 切成多条 open customPath(GE 逐条独立描边 + cap,精确复现 SVG dash)。锁死合成子路径数 + 关键切点几何。
describe('parseCustomPath stroke-dasharray 合成', () => {
  // 水平直线段 0,0→300,0,total=300。dasharray "20 40":on-区间 [60k,60k+20]。
  function dashSvg (dash: string, sw = 4) {
    return make(`<svg xmlns="http://www.w3.org/2000/svg"><polyline points="0,0 300,0" fill="none" stroke="#CC0000" stroke-width="${sw}" stroke-dasharray="${dash}"/></svg>`);
  }

  it('"20 40"(pattern60)切出 5 段 on(open customPath 各 2 点:两端插值),无跨顶点', () => {
    const { es, el } = dashSvg('20 40');
    const s = parseCustomPath(es, el, 'polyline')!;

    // 总长 300,pattern 60,on=[0,20],[60,80],[120,140],[180,200],[240,260] = 5 段([300,320] 越尾裁空)。
    expect(s.customPaths).toHaveLength(5);
    for (const p of s.customPaths) {
      expect(p.closed).toBe(false);
      expect(p.points).toHaveLength(2);   // 水平段无内部顶点,各 dash 仅两端插值点
      // 全直线 → 切线恒 0
      for (const t of [...p.inTangents, ...p.outTangents]) {
        expect(t).toMatchObject({ x: 0, y: 0 });
      }
    }
    // 第 1 段端点 (0,0)-(20,0);polyline bbox 中点 (150,0) → 相对 (-150,0)(-130,0)
    expect(s.customPaths[0].points[0]).toMatchObject({ x: -150, y: 0 });
    expect(s.customPaths[0].points[1]).toMatchObject({ x: -130, y: 0 });
    // 第 2 段 (60,0)-(80,0) → 相对 (-90,0)(-70,0)
    expect(s.customPaths[1].points[0]).toMatchObject({ x: -90, y: 0 });
    expect(s.customPaths[1].points[1]).toMatchObject({ x: -70, y: 0 });
  });

  it('dashoffset 把虚线前移:on 起点从 -offset 起,首段被裁到 [0,...]', () => {
    // dasharray "20 40" offset=10:period 0 on=[-10,10] → 裁 [0,10];period1 on=[50,70]...
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><polyline points="0,0 300,0" fill="none" stroke="#CC0000" stroke-width="4" stroke-dasharray="20 40" stroke-dashoffset="10"/></svg>');
    const s = parseCustomPath(es, el, 'polyline')!;

    // 首段 (0,0)-(10,0) → 相对 (-150,0)(-140,0)
    expect(s.customPaths[0].points[0]).toMatchObject({ x: -150, y: 0 });
    expect(s.customPaths[0].points[1]).toMatchObject({ x: -140, y: 0 });
  });

  it('跨顶点的 on-dash 保留内部顶点(join 在该顶点渲):单 polygon 角点不被丢', () => {
    // 折线 0,0→100,0→200,0(共线中点 100,0 是顶点)。dasharray "150 150":on=[0,150] 跨 100,0 顶点。
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><polyline points="0,0 100,0 200,0" fill="none" stroke="#CC0000" stroke-width="4" stroke-dasharray="150 150"/></svg>');
    const s = parseCustomPath(es, el, 'polyline')!;

    expect(s.customPaths).toHaveLength(1);
    const p = s.customPaths[0];

    expect(p.closed).toBe(false);
    expect(p.points).toHaveLength(3);   // 起 (0,0) + 内部顶点 (100,0) + 止 (150,0)
    // bbox 中点 (100,0):三点相对 (-100,0)(0,0)(50,0)
    expect(p.points[0]).toMatchObject({ x: -100, y: 0 });
    expect(p.points[1]).toMatchObject({ x: 0, y: 0 });
    expect(p.points[2]).toMatchObject({ x: 50, y: 0 });
  });

  it('奇数个 dash 长度按 SVG spec 复制一遍:"7" → "7 7"', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><polyline points="0,0 28,0" fill="none" stroke="#CC0000" stroke-width="4" stroke-dasharray="7"/></svg>');
    const s = parseCustomPath(es, el, 'polyline')!;

    // pattern 14(7 7):on=[0,7],[14,21] → 2 段([28,35] 越尾)
    expect(s.customPaths).toHaveLength(2);
    expect(s.customPaths[0].points[1]).toMatchObject({ x: -14 + 7, y: 0 });   // bbox 中点 14,起 (0,0)-止(7,0) 相对(-14,0)(-7,0)
  });

  it('fill+dash 不合成(超界):保留单条实线并发出 warning', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><polyline points="0,0 60,0" fill="red" stroke="#CC0000" stroke-width="4" stroke-dasharray="20 40"/></svg>');
    const s = parseCustomPath(es, el, 'polyline')!;

    expect(s.customPaths).toHaveLength(1);   // 未合成,原实线单段
    expect(s.customPaths[0].closed).toBe(false);
  });

  it('0 长度 on-dash(点)不合成(超界):保留实线,不误产零长段', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><polyline points="0,0 60,0" fill="none" stroke="#CC0000" stroke-width="4" stroke-dasharray="0 20"/></svg>');
    const s = parseCustomPath(es, el, 'polyline')!;

    expect(s.customPaths).toHaveLength(1);   // 0 长 on-dash 超界,保留原实线
  });

  it('曲线 path(非零切线)不合成(超界):弧长 ≠ 弦长,避免错切', () => {
    const d = 'M0,0 C50,-50 150,-50 200,0';
    const { es, el } = make(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="none" stroke="#CC0000" stroke-width="4" stroke-dasharray="20 40"/></svg>`);
    const s = parseCustomPath(es, el, 'path')!;

    expect(s.customPaths).toHaveLength(1);   // 曲线超界,保留原贝塞尔单段
    expect(s.customPaths[0].closed).toBe(false);
  });

  it('closed polygon 不合成(超界):保留原闭合段', () => {
    const { es, el } = make('<svg xmlns="http://www.w3.org/2000/svg"><polygon points="0,0 60,0 60,60" fill="none" stroke="#CC0000" stroke-width="4" stroke-dasharray="20 40"/></svg>');
    const s = parseCustomPath(es, el, 'polygon')!;

    expect(s.customPaths).toHaveLength(1);
    expect(s.customPaths[0].closed).toBe(true);
  });

});

function polygonArea (points: Array<{ x: number; y: number }>): number {
  let area = 0;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }

  return Math.abs(area) / 2;
}

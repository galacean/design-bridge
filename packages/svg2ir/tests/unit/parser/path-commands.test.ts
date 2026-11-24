import { describe, expect, it } from 'vitest';
import { normalizePathCommands, normalizedToCustomShapePaths } from '../../../src/svg2ir/normalize-path';

// parser 层单测:锁死 SVG d 命令规整化(相对→绝对 / H,V→L / Q,T,S→C 升阶 / A 退化 / Z 闭合 / 多 subpath)
// 与 IR 顶点切线模型填充。对齐 lottie2ge tests/unit/parser/ 把解析逻辑隔离单测的规范。
// 注:A 弧已正确按 SVG sweep/large-arc 语义解析为圆(轴对齐 rx==ry)三次贝塞尔段;
// rx≠ry 的椭圆弧当前退化为直线。

describe('normalizePathCommands', () => {
  it('空 d 补 M(0,0) 开头,防后续 C/L 越界', () => {
    expect(normalizePathCommands('')).toEqual([{ cmd: 'M', x: 0, y: 0 }]);
  });

  it('非 M 开头也补 M(0,0)', () => {
    const cmds = normalizePathCommands('L10 0');

    expect(cmds[0]).toMatchObject({ cmd: 'M', x: 0, y: 0 });
    expect(cmds[1]).toMatchObject({ cmd: 'L', x: 10, y: 0 });
  });

  it('绝对 M/L 原样保留', () => {
    const cmds = normalizePathCommands('M10 20 L30 40');

    expect(cmds).toEqual([
      { cmd: 'M', x: 10, y: 20 },
      { cmd: 'L', x: 30, y: 40 },
    ]);
  });

  it('相对 m/l 累加到绝对', () => {
    const cmds = normalizePathCommands('m10 20 l10 5');

    expect(cmds).toEqual([
      { cmd: 'M', x: 10, y: 20 },
      { cmd: 'L', x: 20, y: 25 },
    ]);
  });

  it('M 后多组坐标按 SVG 规则隐式变成 L', () => {
    expect(normalizePathCommands('M0 0 10 0 10 10')).toEqual([
      { cmd: 'M', x: 0, y: 0 },
      { cmd: 'L', x: 10, y: 0 },
      { cmd: 'L', x: 10, y: 10 },
    ]);
    expect(normalizePathCommands('m10 20 5 6')).toEqual([
      { cmd: 'M', x: 10, y: 20 },
      { cmd: 'L', x: 15, y: 26 },
    ]);
  });

  it('Z 后相对命令从当前子路径起点继续', () => {
    expect(normalizePathCommands('M10 20 L30 20 L30 40 Z m5 6 l2 3')).toEqual([
      { cmd: 'M', x: 10, y: 20 },
      { cmd: 'L', x: 30, y: 20 },
      { cmd: 'L', x: 30, y: 40 },
      { cmd: 'Z' },
      { cmd: 'M', x: 15, y: 26 },
      { cmd: 'L', x: 17, y: 29 },
    ]);
  });

  it('H/V 升级为 L(只用当前 Y / 当前 X)', () => {
    const cmds = normalizePathCommands('M0 0 H50 V60');

    expect(cmds).toEqual([
      { cmd: 'M', x: 0, y: 0 },
      { cmd: 'L', x: 50, y: 0 },
      { cmd: 'L', x: 50, y: 60 },
    ]);
  });

  it('Q 升阶成 C(2/3 控制点变换)', () => {
    const cmds = normalizePathCommands('M0 0 Q50 100 100 0');
    const c = cmds[1] as { cmd: string; x1: number; y1: number; x2: number; y2: number; x: number; y: number };

    expect(c.cmd).toBe('C');
    expect(c.x).toBe(100); expect(c.y).toBe(0);
    // x1 = 0 + 2/3*(50-0) = 33.333..., y1 = 0 + 2/3*(100-0) = 66.666...
    expect(c.x1).toBeCloseTo(100 / 3, 6);
    expect(c.y1).toBeCloseTo(200 / 3, 6);
    expect(c.x2).toBeCloseTo(200 / 3, 6);
    expect(c.y2).toBeCloseTo(200 / 3, 6);
  });

  it('T 反射上一 Q 控制点', () => {
    // M0 0 Q50 100 100 0  → 上一 Q 控制点 (50,100)
    // T200 0 → 反射控制点 = 2*(100,0) - (50,100) = (150,-100),再升阶 C
    const cmds = normalizePathCommands('M0 0 Q50 100 100 0 T200 0');
    const c = cmds[2] as { cmd: string; x1: number; y1: number; x2: number; y2: number; x: number; y: number };

    expect(c.cmd).toBe('C');
    expect(c.x).toBe(200); expect(c.y).toBe(0);
    // 入控制点(由反射的 Q 控制点 150,-100 升阶):x1 = 100 + 2/3*(150-100) = 133.333
    expect(c.x1).toBeCloseTo(400 / 3, 6);
    expect(c.y1).toBeCloseTo(-200 / 3, 6);
  });

  it('S 反射上一 C 的第二控制点', () => {
    // C20 80 80 80 100 0 → lastCtrlC2 = (80,80)
    // S180 80 200 0 → x1 = 2*100 - 80 = 120, y1 = 2*0 - 80 = -80
    const cmds = normalizePathCommands('M0 0 C20 80 80 80 100 0 S180 80 200 0');
    const c = cmds[2] as { cmd: string; x1: number; y1: number; x2: number; y2: number; x: number; y: number };

    expect(c.cmd).toBe('C');
    expect(c.x1).toBe(120); expect(c.y1).toBe(-80);
    expect(c.x2).toBe(180); expect(c.y2).toBe(80);
    expect(c.x).toBe(200); expect(c.y).toBe(0);
  });

  it('A 旋转角非 0 时退化为 L(直线连接)', () => {
    const cmds = normalizePathCommands('M0 0 A20 20 45 0 1 40 0');

    expect(cmds[1]).toMatchObject({ cmd: 'L', x: 40, y: 0 });
  });

  it('A 半径 0 时退化为 L', () => {
    const cmds = normalizePathCommands('M0 0 A0 0 0 0 1 40 0');

    expect(cmds[1]).toMatchObject({ cmd: 'L', x: 40, y: 0 });
  });

  it('A 正常弧产出 C 段,端点落到弧终点', () => {
    const cmds = normalizePathCommands('M0 0 A20 20 0 0 1 40 0');
    const last = cmds[cmds.length - 1];

    expect(last.cmd).toBe('C');
    expect((last as { x: number; y: number }).x).toBeCloseTo(40, 6);
    expect((last as { x: number; y: number }).y).toBeCloseTo(0, 6);
  });

  it('A 四分之一圆弧控制点方向正确(尊重 sweep 方向)', () => {
    // M0 0 A1 1 0 0 1 1 1:中心 (0,1),四分之一圆,正角(CCW)到 (1,1)。
    const cmds = normalizePathCommands('M0 0 A1 1 0 0 1 1 1');
    const segments = cmds.filter(c => c.cmd === 'C') as Array<{ cmd: string; x1: number; y1: number; x2: number; y2: number; x: number; y: number }>;
    const c = segments[0];
    const last = segments[segments.length - 1];

    expect(c.cmd).toBe('C');
    expect(last.x).toBeCloseTo(1, 6);
    expect(last.y).toBeCloseTo(1, 6);
    // 45° 分段后的第一段从 P0=(0,0) 向 45° 端点前进, C1 仍沿切线方向。
    expect(c.x1).toBeGreaterThan(0);
    expect(c.y1).toBeCloseTo(0, 6);
    // 最后一段的终点切线仍指向水平左侧,控制点位于终点上方。
    expect(last.x2).toBeCloseTo(1, 6);
    expect(last.y2).toBeLessThan(1);
  });

  it('A 半圆/大圆弧按角度拆成多段 C', () => {
    // sweep=1 large=0,d=2r 为半圆,拆成四段 45° C。
    const cmds = normalizePathCommands('M0 0 A20 20 0 0 1 40 0');

    expect(cmds.filter(c => (c as { cmd: string }).cmd === 'C')).toHaveLength(4);
  });

  it('A 大圆弧与短圆弧选择不同中心', () => {
    // M0 0 A1 1 0 0 1 1 1 短弧=2 段;large=1 时绕大半圆=6 段。
    const minor = normalizePathCommands('M0 0 A1 1 0 0 1 1 1').filter(c => (c as { cmd: string }).cmd === 'C');
    const major = normalizePathCommands('M0 0 A1 1 0 1 1 1 1').filter(c => (c as { cmd: string }).cmd === 'C');

    expect(minor).toHaveLength(2);
    expect(major.length).toBeGreaterThan(1);
  });

  it('A 椭圆 rx≠ry 退化为直线型 C(控制点重合端点)', () => {
    const cmds = normalizePathCommands('M0 0 A2 1 0 0 1 4 0');
    const c = cmds[1] as { cmd: string; x1: number; y1: number; x2: number; y2: number; x: number; y: number };

    expect(c.cmd).toBe('C');
    expect(c.x).toBeCloseTo(4, 6);
    expect(c.y).toBeCloseTo(0, 6);
    // 控制柄长度为 0 的退化三次曲线=直线
    expect(c.x1).toBeCloseTo(0, 6);
    expect(c.y1).toBeCloseTo(0, 6);
    expect(c.x2).toBeCloseTo(4, 6);
    expect(c.y2).toBeCloseTo(0, 6);
  });

  it('Z 闭合标记', () => {
    const cmds = normalizePathCommands('M0 0 L10 0 L10 10 Z');

    expect(cmds[cmds.length - 1]).toEqual({ cmd: 'Z' });
  });
});

describe('normalizedToCustomShapePaths', () => {
  it('Z 标记 closed,无 Z 则 open', () => {
    expect(normalizedToCustomShapePaths(normalizePathCommands('M0 0 L10 0 L10 10 Z'))[0].closed).toBe(true);
    expect(normalizedToCustomShapePaths(normalizePathCommands('M0 0 L10 0 L10 10'))[0].closed).toBe(false);
  });

  it('多 M 产出多个 sub-path', () => {
    const paths = normalizedToCustomShapePaths(normalizePathCommands('M0 0 L10 0 M20 20 L30 20'));

    expect(paths).toHaveLength(2);
    expect(paths[0].points).toHaveLength(2);
    expect(paths[1].points[0]).toMatchObject({ x: 20, y: 20 });
  });

  it('C 段:outTangents[prev] = C1 - P_prev,inTangents[cur] = C2 - P_cur', () => {
    const paths = normalizedToCustomShapePaths(normalizePathCommands('M0 0 C10 10 20 10 30 0'));
    const p = paths[0];

    expect(p.points).toEqual([{ x: 0, y: 0 }, { x: 30, y: 0 }]);
    expect(p.outTangents[0]).toEqual({ x: 10, y: 10 });
    expect(p.inTangents[1]).toEqual({ x: 20 - 30, y: 10 - 0 });
  });

  it('L 段切线为 0(折线无曲率)', () => {
    const p = normalizedToCustomShapePaths(normalizePathCommands('M0 0 L10 0 L10 10'))[0];

    expect(p.points).toHaveLength(3);
    expect(p.outTangents).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(p.inTangents).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
  });
});

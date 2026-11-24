import { describe, expect, it } from 'vitest';
import { convertSVGToIR } from '@galacean/svg2ir';

// <g mask="url(#X)"> 组级裁剪:<g> 产 null 父层挂 mask,子代 parent.id 指向它;ge-ir applyMasks 父层
// 分支 applyMaskReferenceToDescendants 沿 parentId 树把 mask.reference 戳到所有后代 renderer。
// 子代 transform 世界烤入不动;mask content 乘 <g> 完整链(含 Tg)落 canvas。

/** <g mask transform=(50,50)> + <mask><use href="#mr"/>> + 子 rect。mask content rect(0,0,100,100)
 *  应乘 gChain(50,50)→canvas (50,50)-(150,150);子 rect 世界烤入也落 (50,50)-(150,150) → 对齐裁剪。 */
const SVG_WITH_TG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs><rect id="mr" x="0" y="0" width="100" height="100"/></defs>
  <mask id="M"><use href="#mr"/></mask>
  <g mask="url(#M)" transform="translate(50,50)">
    <rect x="0" y="0" width="100" height="100" fill="red"/>
  </g>
</svg>`;

/** <g mask> 无 transform:mask content 直落 authored(canvas,因 <g> 顶层 gChain=identity)。 */
const SVG_NO_TG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs><rect id="mr" x="10" y="10" width="80" height="80"/></defs>
  <mask id="M"><use href="#mr"/></mask>
  <g mask="url(#M)">
    <rect x="10" y="10" width="80" height="80" fill="red"/>
  </g>
</svg>`;

/** `<g>` 没有 mask 时不生成 null 父层，子层也不挂 parent。 */
const SVG_NO_MASK = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <g transform="translate(50,50)">
    <rect x="0" y="0" width="100" height="100" fill="red"/>
  </g>
</svg>`;

describe('fixture: <g mask> 组级裁剪', () => {
  it('带 Tg:<g> 产 null 父层,mask content 乘 <g> 完整链(含 Tg)落 canvas', async () => {
    const r = convertSVGToIR(SVG_WITH_TG);
    const nullLayer = r.ir.compositions[0].layers.find(l => l.type === 'null');

    expect(nullLayer, '<g mask> 应产 null 父层').toBeDefined();
    expect(nullLayer!.masks?.[0], 'null 父层应挂 group mask').toBeDefined();
    // 外层全覆盖 mask 不应阻止内层 authored mask 生效。
    // rect 4 角 (0,0)(100,0)(100,100)(0,100) × gChain(50,50) → (50,50)(150,50)(150,150)(50,150)。
    const pts = nullLayer!.masks![0].path.points;

    expect(pts).toHaveLength(4);
    expect(pts).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 50, y: 50 }),
      expect.objectContaining({ x: 150, y: 50 }),
      expect.objectContaining({ x: 150, y: 150 }),
      expect.objectContaining({ x: 50, y: 150 }),
    ]));
  });

  it('带 Tg:子 rect 挂 parent.id 指向 null 父层,transform 不动(世界烤入)', async () => {
    const r = convertSVGToIR(SVG_WITH_TG);
    const nullLayer = r.ir.compositions[0].layers.find(l => l.type === 'null');
    const child = r.ir.compositions[0].layers.find(l => l.type === 'shape');

    expect(child, '子 rect 应产 shape layer').toBeDefined();
    expect(child!.parentId, '子代应挂 parent 指向 null 父层').toBeDefined();
    expect(child!.parentId).toBe(nullLayer!.id);
    // 子 rect 世界烤入:<g>(50,50)×rect(0,0,100,100) → 中心 (100,100)。
    const pos = (child!.transform!.position as { value: [number, number, number] }).value;

    expect(pos[0]).toBeCloseTo(100, 5);
    expect(pos[1]).toBeCloseTo(100, 5);
  });

  it('无 Tg:mask content 直落 authored(canvas,因 <g> 顶层 gChain=identity)', async () => {
    const r = convertSVGToIR(SVG_NO_TG);
    const nullLayer = r.ir.compositions[0].layers.find(l => l.type === 'null');

    expect(nullLayer).toBeDefined();
    const pts = nullLayer!.masks![0].path.points;

    expect(pts).toHaveLength(4);
    // rect(10,10,80,80) 4 角,gChain=identity → canvas 直落。
    expect(pts).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 10, y: 10 }),
      expect.objectContaining({ x: 90, y: 10 }),
      expect.objectContaining({ x: 90, y: 90 }),
      expect.objectContaining({ x: 10, y: 90 }),
    ]));
  });

  it('guard:<g> 无 mask 不产 null 父层,子代无 parent', async () => {
    const r = convertSVGToIR(SVG_NO_MASK);
    const nullLayer = r.ir.compositions[0].layers.find(l => l.type === 'null');

    expect(nullLayer, '无 mask 的 <g> 不应产 null 父层').toBeUndefined();
    for (const l of r.ir.compositions[0].layers) {
      expect(l.parentId, '无 <g mask> 时所有子代不应挂 parent').toBeUndefined();
    }
  });

  it('嵌套 <g mask>:外层+内层各产 null 父层,子代挂最近(内层)parent,内层 null 挂外层', async () => {
    const r = convertSVGToIR(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs><rect id="mo" x="0" y="0" width="190" height="200"/><rect id="mi" x="50" y="50" width="100" height="100"/></defs>
  <mask id="Mo"><use href="#mo"/></mask>
  <mask id="Mi"><use href="#mi"/></mask>
  <g mask="url(#Mo)">
    <g mask="url(#Mi)">
      <rect x="50" y="50" width="100" height="100" fill="red"/>
    </g>
  </g>
</svg>`);
    const nulls = r.ir.compositions[0].layers.filter(l => l.type === 'null');

    expect(nulls, '外+内两层 <g mask> 各产一个 null').toHaveLength(2);
    const innerNull = nulls.find(nullLayer => {
      const minX = Math.min(...(nullLayer.masks?.[0]?.path.points ?? []).map(point => point.x));

      return Math.abs(minX - 50) < 0.001;
    });
    const outerNull = nulls.find(n => n !== innerNull);

    expect(innerNull, '应保留内层 mask null').toBeDefined();
    expect(outerNull, '应保留外层 mask null').toBeDefined();
    expect(outerNull!.parentId).toBeUndefined();
    expect(innerNull!.parentId).toBe(outerNull!.id);
    const child = r.ir.compositions[0].layers.find(l => l.type === 'shape');

    expect(child!.parentId).toBe(innerNull!.id);
  });

  it('圆角矩形 path mask:readPathPoints 用 normalizePathCommands(非粗暴 parseNumPairs)', async () => {
    // <mask> 内的圆角矩形 path 可能包含 H/V/A 命令和 arc flags。
    // normalizePathCommands 将 H/V/A 升阶并转为绝对坐标后取端点，保留正确轮廓。
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
      <defs><path id="rm" d="M10,10 H110 A8,8 0 0 1 110,20 V70 A8,8 0 0 1 100,70 H20 A8,8 0 0 1 10,70 V20 A8,8 0 0 1 10,10 Z"/></defs>
      <mask id="M"><use href="#rm"/></mask>
      <g mask="url(#M)"><rect x="0" y="0" width="120" height="80" fill="red"/></g>
    </svg>`;
    const r = convertSVGToIR(svg);
    const nullLayer = r.ir.compositions[0].layers.find(l => l.type === 'null' && l.masks?.[0] != null);

    expect(nullLayer, '圆角矩形 path mask 应产 null 父层').toBeDefined();
    const pts = nullLayer!.masks![0].path.points;

    expect(pts.length).toBeGreaterThan(4); // 多段端点
    // 端点应含圆角矩形角(x≈10/110, y≈10/70),不含 flag 0 误配出的越界点。
    const xs = pts.map(p => p.x); const ys = pts.map(p => p.y);

    expect(Math.min(...xs)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(111);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(71);
  });
});

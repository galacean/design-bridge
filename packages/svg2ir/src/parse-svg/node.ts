/**
 * Node 入口:在 Node 环境(无原生 DOM)注册 svgdom 给 svg.js。
 *
 * 在 Node 环境(无原生 DOM)注册 svgdom 提供的 window/document 给 svg.js,
 * 之后导出的 ParseableSVG 即可在 Node 解析 SVG。浏览器入口(默认 ./index)直接用原生 DOM,无需此桥接。
 *
 * 注:不在构造期做 svgo purify(实测对 svg2ir IR/Effects 输出无影响——
 * svg2ir fixture 零 <style>、svgo 数值字面化但值不变、注释 svg2ir 不消费)。

 */
import { createSVGWindow } from 'svgdom';
import { registerWindow } from '@svgdotjs/svg.js';
import ParseableSVG from './svg-parser';

const window = createSVGWindow();

// svgdom 的 window 是最小 DOM stub(非完整 Window),运行时被 svg.js registerWindow 接受;
// d.ts 标 Window 类型过严,svgdom 的 window 是最小 DOM stub,这里断言对齐运行时用法。
registerWindow(window as unknown as globalThis.Window, window.document);

export default ParseableSVG;
export { ParseableSVG };
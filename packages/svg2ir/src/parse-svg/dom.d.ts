/**
 * svgdom 0.1.14 不带类型声明;此文件提供 Node 入口用到的最小形状(svgdom 是 MIT 开源运行时依赖)。
 * 仅声明 createSVGWindow 返回一个带 window/document 的对象,供 svg.js registerWindow 使用。
 */
declare module 'svgdom' {
  interface SVGWindow {
    document: globalThis.Document;
    [key: string]: unknown;
  }
  export function createSVGWindow (): SVGWindow;
}
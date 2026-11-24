/**
 * Vitest 启动前注入 Node 端 SVG 解析构造器。
 *
 * parse-svg/svg-parser.ts(浏览器向,无 svgdom)是默认构造器,parse-svg/node.ts(Node 向,register svgdom)
 * 需经 Node 入口注入。import '../src/node' 触发 setEditableSVGConstructor(parse-svg/node),之后 root
 * convertSVGToIR 经 parse-svg/bridge.ts 的 createEditableSVG 用 Node 构造器(含 svgdom registerWindow),
 * Node 测试可解析 SVG。
 */
import '../src/node';
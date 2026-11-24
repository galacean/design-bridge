/**
 * helper 入口：SVG 转换辅助工具，不包含在 `@galacean/svg2ir` 主入口的最小依赖集合中。
 */

/** 从字体族名推断数值字重(100-950)，与 svg2ir 生产路径共用同一套解析逻辑。 */
export { inferNumericWeightFromFamily } from './svg2ir/converter/text/font-metrics';

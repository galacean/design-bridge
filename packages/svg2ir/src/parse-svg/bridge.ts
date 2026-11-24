import * as editableSVGModule from './svg-parser';
import type EditableSVG from './svg-parser';

export type EditableSVGConstructor = typeof EditableSVG;

type UnknownRecord = Record<string, unknown>;

function isRecord (value: unknown): value is UnknownRecord {
  return value != null && typeof value === 'object';
}

/**
 * 将浏览器 ESM/CJS 互操作和 Node CJS 入口统一为同一个构造器。
 * parser 只依赖这个边界，不依赖具体模块系统的默认导出形式。
 */
export function resolveEditableSVGConstructor (moduleValue: unknown): EditableSVGConstructor {
  let candidate: unknown = moduleValue;

  for (let depth = 0; depth < 3; depth++) {
    if (typeof candidate === 'function') {
      return candidate as EditableSVGConstructor;
    }

    if (!isRecord(candidate) || !('default' in candidate)) {
      break;
    }

    candidate = candidate.default;
  }

  throw new TypeError('EditableSVG module does not expose a constructor.');
}

let editableSVGConstructor = resolveEditableSVGConstructor(editableSVGModule);

/** 配置 Node 发行入口使用的构造器。 */
export function setEditableSVGConstructor (constructor: EditableSVGConstructor): void {
  editableSVGConstructor = constructor;
}

export function createEditableSVG (...args: ConstructorParameters<EditableSVGConstructor>): EditableSVG {
  return new editableSVGConstructor(...args);
}

import * as editableSVGNodeModule from './parse-svg/node';
import { resolveEditableSVGConstructor, setEditableSVGConstructor } from './parse-svg/bridge';

setEditableSVGConstructor(resolveEditableSVGConstructor(editableSVGNodeModule));

export * from './index';

import type { FigmaIR, SceneNode } from '../../src/types';

export function makeIR(overrides: Partial<FigmaIR> = {}): FigmaIR {
  return {
    figmaType: 'FRAME',
    opacity: 1,
    isAbsolute: false,
    fills: [],
    effects: [],
    clipsContent: false,
    flexGrow: 0,
    ...overrides,
  };
}

export function makeSceneNode(overrides: Partial<SceneNode> = {}): SceneNode {
  const overrideIR = overrides.ir as Partial<FigmaIR> | undefined;
  const { ir: _ignoredIR, ...nodeOverrides } = overrides;

  void _ignoredIR;

  return {
    type: 'frame',
    name: 'Node',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    text: null,
    svg: null,
    image: null,
    backgroundImage: null,
    styles: {},
    children: [],
    ir: makeIR(overrideIR),
    ...nodeOverrides,
  };
}

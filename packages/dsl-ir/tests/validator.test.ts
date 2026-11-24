import { describe, expect, it } from 'vitest';
import { IREndBehavior, type IRComposition, type IRLayer } from '@galacean/animation-ir';
import { convertIRToGE as convertIRSceneToGE } from '@galacean/ge-ir';
import {
  convertIRToDSL as convertIRSceneToDSL, validateDSL,
  type Composition, type DSLValidationResult, type Layer, type NumberExpression, type ParticleShape,
} from '../src';
import { lintDSL } from '../src/dsl/validator/validation';
import { DSL_CODE_LABELS } from '../src/dsl/validator/labels';
import { convertGEToDSL } from './helpers/ge-dsl-integration';
import { createTestLayer } from './fixtures/dsl';
import { createTestIRScene, migrateTestLayerAsset, type TestIRLayerOverrides } from './fixtures/ir';

function layer(id: string, type: 'null' | 'layer' | 'text' | 'particle' = 'null'): Record<string, unknown> {
  return {
    id,
    name: id,
    type,
    width: 10,
    height: 10,
    description: { self: '', composite: '' },
    parent: null,
    time_range: [0, 2],
    position: { a: false, value: [0, 0, 0] },
    rotation: { a: false, value: [0, 0, 0] },
    scale: { a: false, value: [1, 1, 1] },
    anchor: { a: false, value: [0, 0, 0] },
    opacity: { a: false, value: 1 },
    children: [],
    ...(type === 'layer' && {
      asset: { source: 'user', url: 'https://example.com/a.png', prompt: '' },
    }),
    ...(type === 'text' && { text: { content: 'hello', size: 16, color: '#000000' } }),
    ...(type === 'particle' && {
      particle: {
        options: { maxCount: 50, startLifetime: [4, [1, 2]] },
      emission: {
        rateOverTime: [0, 0],
        bursts: [{ time: 0, count: 20, cycles: 1, interval: 0 }],
      },
      },
    }),
  };
}

function document(layers: Array<Record<string, unknown>> = []): Record<string, unknown> {
  return {
    meta: {
      name: 'fixture', duration: 2, fps: 30, width: 10, height: 10, loop: true, background_color: null,
    },
    layers,
  };
}

const warningLayer = layer('warning');

warningLayer['time_range'] = [0, 3];

const missingText = layer('text', 'text');

delete missingText['text'];

const invalidAsset = layer('asset', 'layer');

invalidAsset['asset'] = { source: 'ai', url: 'https://example.com/a.png', prompt: 'draw' };

const child = layer('child', 'layer');

child['parent'] = 'root';
const root = layer('root');

root['children'] = [child];

const curveLayer = layer('curve');

curveLayer['position'] = {
  a: true,
  animation: [
    { t: [0, 1.2], start: [0, 0, 0], end: [1, 1, 1], easing: [0, 0, 1, 1] },
    { t: [1, 2.5], start: [2, 2, 2], end: [3, 3, 3], easing: [0, 0, 1] },
  ],
};

const RULE_CASES: Record<string, string> = {
  clean: JSON.stringify(document()),
  'root-array': '[]',
  'missing-meta': JSON.stringify({ layers: [] }),
  'meta-warning': JSON.stringify({
    ...document(),
    meta: { ...(document()['meta'] as object), background_color: 'red' },
  }),
  tree: JSON.stringify(document([root])),
  'warning-time-range': JSON.stringify(document([warningLayer])),
  'missing-text': JSON.stringify(document([missingText])),
  'invalid-asset': JSON.stringify(document([invalidAsset])),
  duplicate: JSON.stringify(document([layer('same'), layer('same')])),
  curves: JSON.stringify(document([curveLayer])),
};

function addDocumentCase(name: string, value: Record<string, unknown>): void {
  RULE_CASES[name] = JSON.stringify(value);
}

function addLayerCase(name: string, mutate: (value: Record<string, unknown>) => void): void {
  const value = layer(`layer-${name}`);

  mutate(value);
  addDocumentCase(name, document([value]));
}

function animatedCurve(): Record<string, unknown> {
  return { t: [0, 1], start: [0, 0, 0], end: [1, 1, 1], easing: [0, 0, 1, 1] };
}

addDocumentCase('R003', { meta: document()['meta'] });
addDocumentCase('R004', { ...document(), layers: {} });
addDocumentCase('R005', { ...document(), meta: 7 });
addLayerCase('A027', value => {
  value['type'] = 'text';
  value['text'] = { content: 'x', size: 16, color: '#000000', line_height: 0 };
});

for (const field of ['name', 'duration', 'fps', 'width', 'height', 'loop']) {
  const value = document();

  delete (value['meta'] as Record<string, unknown>)[field];
  addDocumentCase(`M001-${field}`, value);
}

for (const [field, value] of [
  ['name', 1],
  ['duration', 'x'],
  ['fps', 'invalid'],
  ['width', 'invalid'],
  ['height', 'invalid'],
  ['loop', 1],
] as const) {
  const invalid = document();

  (invalid['meta'] as Record<string, unknown>)[field] = value;
  addDocumentCase(`M002-${field}`, invalid);
}

for (const [name, patch] of [
  ['M003', { background_color: 1 }],
  ['M004', { background_color: 'red' }],
  ['M005', { fps: 0 }],
  ['M006-width', { width: 0 }],
  ['M006-height', { height: 0 }],
  ['M007', { duration: 0 }],
] as const) {
  const value = document();

  Object.assign(value['meta'] as object, patch);
  addDocumentCase(name, value);
}

addLayerCase('L001', value => {
  delete value['id'];
});
addLayerCase('L002', value => {
  value['id'] = 1;
});
addLayerCase('L003', value => {
  value['id'] = '';
});
addLayerCase('L004', value => {
  delete value['name'];
});
addLayerCase('L005', value => {
  value['name'] = 1;
});
addLayerCase('L006', value => {
  delete value['type'];
});
addLayerCase('L007', value => {
  value['type'] = 'shape';
});
addLayerCase('L008', value => {
  delete value['width'];
});
addLayerCase('L009', value => {
  value['width'] = 'wide';
});
addLayerCase('L009-negative', value => {
  value['width'] = -1;
});
addLayerCase('L010', value => {
  delete value['height'];
});
addLayerCase('L011', value => {
  value['height'] = 'tall';
});
addLayerCase('L011-negative', value => {
  value['height'] = -1;
});
addLayerCase('L012', value => {
  delete value['description'];
});
addLayerCase('L013', value => {
  value['description'] = 'description';
});
addLayerCase('L014', value => {
  delete (value['description'] as Record<string, unknown>)['self'];
});
addLayerCase('L015', value => {
  delete (value['description'] as Record<string, unknown>)['composite'];
});
addLayerCase('L016', value => {
  (value['description'] as Record<string, unknown>)['self'] = 1;
});
addLayerCase('L018', value => {
  value['time_range'] = [0];
});
addLayerCase('L019', value => {
  value['time_range'] = [0, 'two'];
});
addLayerCase('L020', value => {
  value['time_range'] = [2, 1];
});
addDocumentCase('L021', document([1 as unknown as Record<string, unknown>]));
addLayerCase('L022', value => {
  value['children'] = {};
});
addLayerCase('L023', value => {
  value['time_range'] = [0, 3];
});
addLayerCase('L024', value => {
  value['type'] = 'layer';
  value['width'] = 0;
  value['asset'] = { source: 'user', url: 'a.png', prompt: '' };
});

addLayerCase('P001', value => {
  delete value['position'];
});
addLayerCase('P002', value => {
  value['position'] = 1;
});
addLayerCase('P003', value => {
  value['position'] = {};
});
addLayerCase('P004', value => {
  value['position'] = { a: 1, value: [0, 0, 0] };
});
addLayerCase('P005', value => {
  value['position'] = { a: false };
});
addLayerCase('P006', value => {
  value['position'] = { a: false, value: [0, 0, 0], animation: [] };
});
addLayerCase('P007', value => {
  value['position'] = { a: true };
});
addLayerCase('P008', value => {
  value['position'] = { a: true, animation: {} };
});
addLayerCase('P009', value => {
  value['position'] = { a: true, animation: [animatedCurve()], value: [0, 0, 0] };
});
addLayerCase('P010', value => {
  value['position'] = { a: true, animation: [] };
});
addLayerCase('P011', value => {
  value['position'] = { a: false, value: [0, 0] };
});
addLayerCase('P012', value => {
  value['opacity'] = { a: false, value: [1] };
});
addLayerCase('P013', value => {
  value['position'] = { a: false, value: [0, 'x', 0] };
});
addLayerCase('P014', value => {
  value['opacity'] = { a: false, value: 2 };
});
addLayerCase('P015', value => {
  value['anchor'] = { a: true, animation: [animatedCurve()] };
});

function addPositionCurveCase(name: string, mutate: (curve: Record<string, unknown>) => void): void {
  addLayerCase(name, value => {
    const curve = animatedCurve();

    mutate(curve);
    value['position'] = { a: true, animation: [curve] };
  });
}

addLayerCase('C001', value => {
  value['position'] = { a: true, animation: [1] };
});
addPositionCurveCase('C002', curve => {
  delete curve['t'];
});
addPositionCurveCase('C003', curve => {
  curve['t'] = [0];
});
addPositionCurveCase('C004', curve => {
  curve['t'] = [1, 0];
});
addPositionCurveCase('C005', curve => {
  curve['t'] = [0, 'one'];
});
addPositionCurveCase('C006', curve => {
  delete curve['start'];
});
addPositionCurveCase('C007', curve => {
  delete curve['end'];
});
addPositionCurveCase('C008', curve => {
  curve['start'] = [0, 0];
});
addLayerCase('C009', value => {
  value['opacity'] = {
    a: true,
    animation: [{ t: [0, 1], start: [0], end: [1, 2], easing: [0, 0, 1, 1] }],
  };
});
addLayerCase('C010', value => {
  value['opacity'] = {
    a: true,
    animation: [{ t: [0, 1], start: 0, end: 1, easing: [0, 0, 1, 1] }],
  };
});
addLayerCase('C017', value => {
  value['opacity'] = {
    a: true,
    animation: [{ t: [0, 1], start: [-0.2], end: [1.2], easing: [0, 0, 1, 1] }],
  };
});
addPositionCurveCase('C011', curve => {
  curve['easing'] = [0, 1];
});
addPositionCurveCase('C012', curve => {
  curve['easing'] = [0, 'x', 1, 1];
});
addLayerCase('C013', value => {
  value['rotation'] = { a: true, animation: [{ ...animatedCurve(), in: [0, 0, 0] }] };
});
addPositionCurveCase('C014', curve => {
  curve['in'] = [0, 0];
});
addPositionCurveCase('C016', curve => {
  curve['t'] = [0, 3];
});

function addContinuityCase(name: string, secondPatch: Record<string, unknown>): void {
  addLayerCase(name, value => {
    value['position'] = {
      a: true,
      animation: [
        animatedCurve(),
        { t: [1, 2], start: [1, 1, 1], end: [2, 2, 2], easing: [0, 0, 1, 1], ...secondPatch },
      ],
    };
  });
}

addContinuityCase('S002', { t: [0.5, 2] });
addContinuityCase('S003', { t: [1.5, 2] });
addContinuityCase('S004', { t: [-0.5, 0.5] });

addDocumentCase('X001', document([layer('duplicate'), layer('duplicate')]));
addLayerCase('X002', value => {
  value['parent'] = value['id'];
});
addLayerCase('X003', value => {
  value['parent'] = 1;
});
addLayerCase('X004', value => {
  value['parent'] = 'missing';
});
addDocumentCase('X005', document([layer('root'), { ...layer('child'), parent: 'root' }]));
const cycleA = layer('cycle-a');
const cycleB = layer('cycle-b');

cycleA['parent'] = 'cycle-b';
cycleB['parent'] = 'cycle-a';
addDocumentCase('X006', document([cycleA, cycleB]));

addLayerCase('A001', value => {
  value['type'] = 'layer';
});
addLayerCase('A002', value => {
  value['type'] = 'layer';
  value['asset'] = 'asset';
});
addLayerCase('A003', value => {
  value['type'] = 'layer';
  value['asset'] = {};
});
addLayerCase('A004', value => {
  value['type'] = 'layer';
  value['asset'] = { source: 'ai' };
});
addLayerCase('A005', value => {
  value['type'] = 'layer';
  value['asset'] = { source: 'llm_svg', format: 'png', svg: '<svg/>', prompt: 'x' };
});
addLayerCase('A006', value => {
  value['type'] = 'layer';
  value['asset'] = { source: 'llm_svg', format: 'svg', prompt: 'x' };
});
addLayerCase('A007', value => {
  value['type'] = 'layer';
  value['asset'] = { source: 'llm_svg', format: 'svg', svg: '<svg/>' };
});
addLayerCase('A008', value => {
  value['type'] = 'layer';
  value['asset'] = { source: 'user', prompt: '' };
});
addLayerCase('A008-relative', value => {
  value['type'] = 'layer';
  value['asset'] = { source: 'user', url: './image.png', prompt: '' };
});
addLayerCase('A009', value => {
  value['type'] = 'layer';
  value['asset'] = { source: 'user', url: 'a.png', prompt: 'x' };
});
addLayerCase('A010', value => {
  value['asset'] = { source: 'user', url: 'a.png', prompt: '' };
});
addLayerCase('A011', value => {
  value['type'] = 'text';
});
addLayerCase('A012', value => {
  value['type'] = 'text';
  value['text'] = 'text';
});
addLayerCase('A013', value => {
  value['type'] = 'text';
  value['text'] = { size: 16, color: '#000000' };
});
addLayerCase('A014', value => {
  value['type'] = 'text';
  value['text'] = { content: 'x', size: 'large', color: '#000000' };
});
addLayerCase('A014-negative', value => {
  value['type'] = 'text';
  value['text'] = { content: 'x', size: -1, color: '#000000' };
});
addLayerCase('A015', value => {
  value['type'] = 'text';
  value['text'] = { content: 'x', size: 16, color: 0 };
});
addLayerCase('A016', value => {
  value['type'] = 'layer';
  value['asset'] = { source: 'user', url: 'a.png', prompt: '' };
  value['text'] = { content: 'x', size: 16, color: '#000000' };
});
addLayerCase('A017', value => {
  value['type'] = 'text';
  value['text'] = { content: 'x', size: 16, color: '#000000' };
  value['asset'] = { source: 'user', url: 'a.png', prompt: '' };
});
addLayerCase('A018', value => {
  value['type'] = 'text';
  value['text'] = { content: 'x', size: 16, color: '#000000', font: 400 };
});
addLayerCase('A019', value => {
  value['type'] = 'text';
  value['text'] = { content: 'x', size: 16, color: '#000000', align: 'justify' };
});
addLayerCase('A020', value => {
  value['type'] = 'text';
  value['text'] = { content: 'x', size: 16, color: '#000000', line_height: 'normal' };
});
addLayerCase('A021', value => {
  value['type'] = 'layer';
  value['asset'] = { source: 'llm_svg', format: 'svg', svg: '<svg/>', prompt: 'x', url: 1 };
});
addLayerCase('A022', value => {
  value['type'] = 'particle';
});
addLayerCase('A023', value => {
  value['type'] = 'particle';
  value['particle'] = 'particle';
});
addLayerCase('A024', value => {
  value['particle'] = {};
});
addLayerCase('A025', value => {
  value['type'] = 'particle';
  value['particle'] = layer('particle-content', 'particle')['particle'];
  value['asset'] = { source: 'user', url: 'https://example.com/particle.png', prompt: '' };
});
addLayerCase('A026', value => {
  value['type'] = 'particle';
  value['particle'] = layer('particle-content', 'particle')['particle'];
  value['text'] = { content: 'x', size: 16, color: '#000000' };
});
addLayerCase('PT001', value => {
  value['type'] = 'particle';
  const particle = layer('particle-content', 'particle')['particle'] as Record<string, unknown>;

  delete particle['emission'];
  value['particle'] = particle;
});
addLayerCase('PT002', value => {
  value['type'] = 'particle';
  const particle = layer('particle-content', 'particle')['particle'] as Record<string, unknown>;

  particle['emission'] = { rateOverTime: [-1, 2] };
  value['particle'] = particle;
});
addLayerCase('PT003', value => {
  value['type'] = 'particle';
  const particle = layer('particle-content', 'particle')['particle'] as Record<string, unknown>;

  particle['emission'] = { rateOverTime: [0, 1], bursts: {} };
  value['particle'] = particle;
});
addLayerCase('PT004', value => {
  value['type'] = 'particle';
  const particle = layer('particle-content', 'particle')['particle'] as Record<string, unknown>;

  particle['emission'] = { rateOverTime: [0, 1], bursts: [{ time: 0, count: '20' }] };
  value['particle'] = particle;
});
addLayerCase('PT005', value => {
  value['type'] = 'particle';
  value['particle'] = {
    ...(layer('particle-content', 'particle')['particle'] as object),
    renderer: {},
  };
});
addLayerCase('PT006', value => {
  value['type'] = 'particle';
  const particle = layer('particle-content', 'particle')['particle'] as Record<string, unknown>;

  delete particle['options'];
  value['particle'] = particle;
});
addLayerCase('PT007', value => {
  value['type'] = 'particle';
  const particle = layer('particle-content', 'particle')['particle'] as Record<string, unknown>;

  particle['options'] = { maxCount: 0, startLifetime: [0, 1] };
  value['particle'] = particle;
});
addLayerCase('PT008', value => {
  value['type'] = 'particle';
  const particle = layer('particle-content', 'particle')['particle'] as Record<string, unknown>;

  particle['options'] = { maxCount: 50, startLifetime: [4, [2, 1]] };
  value['particle'] = particle;
});
addLayerCase('PT009', value => {
  value['type'] = 'particle';
  const particle = layer('particle-content', 'particle')['particle'] as Record<string, unknown>;

  particle['shape'] = { type: 8, shape: 'Sphere', arcMode: 0 };
  value['particle'] = particle;
});
describe('DSL validator', () => {
  it('returns the DSL validator result contract', () => {
    expect(validateDSL(document())).toEqual({
      result: 'pass',
      summary: '0 errors, 0 warnings',
      errors: [],
      warnings: [],
    });
  });

  it('returns warnings without failing validation', () => {
    const result = validateDSL(document([warningLayer]));

    expect(result.result).toBe('pass');
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('ignores fields outside the DSL contract', () => {
    const value = {
      ...document([{ ...layer('extra-layer'), sourceSpecificData: {} }]),
      extensionData: {},
    };

    expect(validateDSL(value)).toEqual({
      result: 'pass',
      summary: '0 errors, 0 warnings',
      errors: [],
      warnings: [],
    });
  });

  it('reports malformed JSON without throwing', () => {
    const result = validateDSL('{ not valid json');

    expect(result.result).toBe('fail');
    expect(result.errors[0]).toMatchObject({ code: 'INPUT_ERROR', path: '', layerId: null });
  });

  it('uses camelCase fields and JavaScript value terminology in diagnostics', () => {
    const invalidTypeLayer = layer('invalid-type');

    invalidTypeLayer['type'] = Number.POSITIVE_INFINITY;
    const typeResult = validateDSL(document([invalidTypeLayer]));
    const rootResult = validateDSL(null);

    expect(rootResult.errors[0]).toMatchObject({ layerId: null });
    expect(rootResult.errors[0]).not.toHaveProperty('layer_id');
    expect(rootResult.errors[0].message).toContain('got null');
    expect(typeResult.errors).toContainEqual(expect.objectContaining({
      message: expect.stringContaining('type Infinity'),
    }));
    expect(JSON.stringify([rootResult, typeResult])).not.toMatch(/NoneType|\bNone\b|\bdict\b|\blist\b|\binf\b/);
  });

  it('rejects circular object input without recursing forever', () => {
    const circular = document();

    circular['self'] = circular;
    expect(validateDSL(circular).errors[0]).toMatchObject({ code: 'INPUT_ERROR' });
    expect(lintDSL(circular).issues[0]).toMatchObject({ code: 'R001' });
  });

  it('keeps lintDSL available for severity-preserving diagnostics', () => {
    const report = lintDSL(document([missingText]));

    expect(report.hasErrors).toBe(true);
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'ERROR', code: 'A011' }));
  });

  it('accepts only the constant and random NumberExpression variants supported by the particle DSL', () => {
    const expressions: [startLifetime: NumberExpression, rateOverTime: NumberExpression][] = [
      [[0, 2], [0, 0]],
      [[4, [1.5, 3.5]], [4, [0.3, 0.6]]],
    ];

    for (const [startLifetime, rateOverTime] of expressions) {
      const value = layer('particle-value', 'particle');
      const particle = value['particle'] as Record<string, unknown>;

      particle['options'] = { maxCount: 60, startLifetime };
      particle['emission'] = { rateOverTime };
      expect(validateDSL(document([value])).errors).toEqual([]);
    }

    const unsupportedExpressions = [
      2,
      [1.5, 3.5],
      [5, [[0, 0], [1, 1]]],
      [6, [[0, 0, 0, 0]]],
      [21, []],
    ];

    for (const rateOverTime of unsupportedExpressions) {
      const value = layer('particle-curve', 'particle');
      const particle = value['particle'] as Record<string, unknown>;

      particle['emission'] = { rateOverTime };
      expect(validateDSL(document([value])).errors).toContainEqual(expect.objectContaining({ code: 'PT002' }));
    }
  });

  it('accepts every particle emitter shape defined by the DSL contract', () => {
    const shapes: ParticleShape[] = [
      { type: 0, shape: 'None' },
      { type: 1, shape: 'Sphere', arcMode: 0, radius: 1, arc: 360 },
      { type: 2, shape: 'Cone', arcMode: 1, angle: 25, radius: 1, arc: 180 },
      { type: 3, shape: 'Hemisphere', arcMode: 2, radius: 1, arc: 360 },
      { type: 4, shape: 'Circle', arcMode: 3, radius: 1, arc: 360 },
      { type: 5, shape: 'Donut', arcMode: 0, radius: 1, donutRadius: 0.25, arc: 360 },
      { type: 6, shape: 'Rectangle', arcMode: 0, width: 3, height: 2 },
      { type: 7, shape: 'RectangleEdge', arcMode: 0, width: 3, height: 2 },
      { type: 8, shape: 'Edge', arcMode: 0, width: 3 },
      {
        type: 9,
        shape: 'Texture',
        arcMode: 0,
        detail: { width: 2, height: 2, block: [1, 1], anchors: [0, 0, 1, 1] },
        random: 0,
        width: 2,
        height: 2,
      },
    ];

    for (const shape of shapes) {
      const value = layer(`particle-shape-${shape.type}`, 'particle');
      const particle = value['particle'] as Record<string, unknown>;

      particle['shape'] = shape;
      expect(validateDSL(document([value])).errors).toEqual([]);
    }
  });

  it('requires positive particle authoring bounds', () => {
    const value = layer('particle-bounds', 'particle');

    value['width'] = 0;
    expect(validateDSL(document([value])).errors).toContainEqual(expect.objectContaining({ code: 'L024' }));
  });

  it('enforces positive lifetime and keeps repeated bursts within the layer duration', () => {
    const value = layer('particle-timing', 'particle');
    const particle = value['particle'] as Record<string, unknown>;

    particle['options'] = { maxCount: 60, startLifetime: [0, 0] };
    particle['emission'] = {
      rateOverTime: [0, 0],
      bursts: [
        { time: 1, count: 20, cycles: 3, interval: 0.5 },
        { time: 2, count: 1, cycles: 1, interval: 0 },
      ],
    };

    const errors = validateDSL(document([value])).errors;

    expect(errors).toContainEqual(expect.objectContaining({ code: 'PT008' }));
    expect(errors).toContainEqual(expect.objectContaining({
      code: 'PT004', path: 'layers[0].particle.emission.bursts[0]',
    }));
    expect(errors).toContainEqual(expect.objectContaining({
      code: 'PT004', path: 'layers[0].particle.emission.bursts[1].time',
    }));
  });

  it.each([0, undefined])('requires a positive repeat interval with cycles=%s', cycles => {
    const value = layer('particle-repeat', 'particle');
    const particle = value['particle'] as Record<string, unknown>;

    particle['emission'] = {
      rateOverTime: [0, 0],
      bursts: [{ time: 0, count: 20, ...(cycles !== undefined && { cycles }), interval: 0.5 }],
    };
    expect(validateDSL(document([value])).errors).toEqual([]);

    particle['emission'] = {
      rateOverTime: [0, 0],
      bursts: [{ time: 0, count: 20, ...(cycles !== undefined && { cycles }) }],
    };
    expect(validateDSL(document([value])).errors).toContainEqual(expect.objectContaining({
      code: 'PT004', path: 'layers[0].particle.emission.bursts[0].interval',
    }));
  });

  it('rejects explicit null burst fields instead of treating them as omitted', () => {
    const value = layer('particle-null-burst', 'particle');
    const particle = value['particle'] as Record<string, unknown>;

    particle['emission'] = {
      rateOverTime: [0, 0],
      bursts: [{ time: 0, count: 20, cycles: null, interval: null }],
    };

    expect(validateDSL(document([value])).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PT004', path: 'layers[0].particle.emission.bursts[0].cycles' }),
      expect.objectContaining({ code: 'PT004', path: 'layers[0].particle.emission.bursts[0].interval' }),
    ]));
  });

  it('covers every DSL lint code in the rule corpus', () => {
    const covered = new Set(
      Object.values(RULE_CASES).flatMap(raw => {
        const result = validateDSL(raw);

        return [...result.errors, ...result.warnings].map(issue => issue.code);
      }),
    );

    expect([...covered].sort()).toEqual(Object.keys(DSL_CODE_LABELS).sort());
  });
});

function validateStandardDSL(dsl: Composition): DSLValidationResult {
  return validateDSL(dsl);
}

function createConformanceComposition(layers: Layer[]): Composition {
  return {
    meta: {
      name: 'dsl-conformance',
      duration: 2,
      fps: 30,
      width: 400,
      height: 300,
      loop: true,
      background_color: null,
    },
    layers,
  };
}

function createConformanceIRLayer(
  overrides: TestIRLayerOverrides & { orderIndex: number; name: string },
): IRLayer {
  const { orderIndex, imageUrl, imageAssetId, asset, ...layerOverrides } = overrides;
  const id = `layer-${orderIndex}`;

  return {
    id,
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    transform: {
      position: { type: 'static', value: [0, 0, 0] },
      rotation: { z: { type: 'static', value: 0 } },
      scale: { type: 'static', value: [1, 1, 1] },
      anchor: { type: 'static', value: [0, 0, 0] },
      opacity: { type: 'static', value: 1 },
    },
    ...layerOverrides,
    ...migrateTestLayerAsset(id, overrides.type, imageUrl, imageAssetId, asset, overrides.localBounds),
  } as IRLayer;
}

function createConformanceIRComposition(layers: IRLayer[]): IRComposition {
  return {
    id: 'test-composition',
    name: 'fixture',
    width: 400,
    height: 300,
    frameRate: 30,
    inPoint: 0,
    outPoint: 60,
    endBehavior: IREndBehavior.Loop,
    layers,
  };
}

function convertConformanceIRToGE(ir: IRComposition): ReturnType<typeof convertIRSceneToGE>['scene'] {
  return convertIRSceneToGE(createTestIRScene(ir)).scene;
}

function convertConformanceIRToDSL(ir: IRComposition): ReturnType<typeof convertIRSceneToDSL> {
  return convertIRSceneToDSL(createTestIRScene(ir));
}

describe('DSL validator conformance', () => {
  it('accepts standard user, text, llm_svg, hierarchy, and animation documents', () => {
    const root = createTestLayer('root', 'Root', 'null');
    const user = createTestLayer('user', 'User asset', 'layer');
    const text = createTestLayer('text', 'Text', 'text');
    const svg = createTestLayer('svg', 'SVG', 'layer');

    for (const currentLayer of [root, user, text, svg]) {
      currentLayer.time_range = [0, 2];
    }
    user.parent = root.id;
    user.asset = { source: 'user', url: 'https://example.com/user.png', prompt: '' };
    user.position = {
      a: true,
      animation: [
        {
          t: [0, 2],
          start: [0, 0, 0],
          end: [100, 50, 0],
          easing: [0.42, 0, 0.58, 1],
          in: [-5, -5, 0],
          out: [5, 5, 0],
        },
      ],
    };
    text.text = { content: 'Hello', font: 'Arial', size: 24, color: '#ff0000', align: 'center' };
    svg.asset = {
      source: 'llm_svg',
      format: 'svg',
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>',
      prompt: 'a red circle',
    };
    root.children = [user];
    const report = validateStandardDSL(createConformanceComposition([root, text, svg]));

    expect(report.result, JSON.stringify(report, null, 2)).toBe('pass');
    expect(report.errors).toHaveLength(0);
  });

  it('accepts direct IR-to-DSL and composed GE-to-DSL output without duplicate physical ids', () => {
    const ir = createConformanceIRComposition([
      createConformanceIRLayer({ orderIndex: 0, name: 'root', type: 'null' }),
      createConformanceIRLayer({
        orderIndex: 1,
        name: 'image',
        type: 'image',
        parentId: 'layer-0',
        localBounds: { x: 0, y: 0, width: 80, height: 80 },
        imageUrl: 'https://example.com/image.png',
      }),
      createConformanceIRLayer({
        orderIndex: 2,
        name: 'shape-without-asset',
        type: 'shape',
        content: { shapes: [] },
      }),
    ]);
    const converted = convertConformanceIRToDSL(ir);
    const convertedGE = convertGEToDSL(
      convertConformanceIRToGE(ir) as unknown as Record<string, unknown>,
      { frameRate: 30 },
    );

    for (const dsl of [converted.dsl, convertedGE.dsl]) {
      const report = validateStandardDSL(dsl);

      expect(report.result, JSON.stringify(report, null, 2)).toBe('pass');
      expect(report.errors).toEqual([]);
      expect(report.errors).not.toContainEqual(expect.objectContaining({ code: 'X001' }));
      expect(report.errors).not.toContainEqual(expect.objectContaining({ code: 'A011' }));
    }
  });

  it('reports out-of-composition timing as a warning', () => {
    const currentLayer = createTestLayer('root', 'Root', 'null');

    currentLayer.time_range = [0, 3];
    const dsl = createConformanceComposition([currentLayer]);
    const normal = validateStandardDSL(dsl);

    expect(normal.result).toBe('pass');
    expect(normal.errors).toHaveLength(0);
    expect(normal.warnings.length).toBeGreaterThan(0);
  });
});

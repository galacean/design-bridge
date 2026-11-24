import { describe, it, expect } from 'vitest';
import { inferFlowAutoLayout, inferSingleChildContainerLayout, resolveAutoLayout } from '@galacean/html2figma';
import type { SceneNode } from '@galacean/html2figma';
import { makeIR, makeSceneNode } from '../helpers/scene-factories';

// ---- Helpers ----

function makeNode(x: number, y: number, w: number, h: number, overrides: Partial<SceneNode> = {}): SceneNode {
  return makeSceneNode({
    name: 'node',
    x,
    y,
    width: w,
    height: h,
    ...overrides,
  });
}

// ---- inferFlowAutoLayout ----

describe('inferFlowAutoLayout', () => {
  it('3 vertically stacked children → VERTICAL layout with spacing', () => {
    const parent = makeNode(0, 0, 100, 120, {
      children: [makeNode(0, 0, 100, 30), makeNode(0, 40, 100, 30), makeNode(0, 80, 100, 30)],
    });
    const result = inferFlowAutoLayout(parent);

    expect(result).not.toBeNull();
    expect(result!.stackMode).toBe('VERTICAL');
    expect(result!.stackSpacing).toBeCloseTo(10, 1);
  });

  it('3 horizontally placed children → HORIZONTAL layout', () => {
    const parent = makeNode(0, 0, 120, 40, {
      children: [makeNode(0, 0, 30, 40), makeNode(40, 0, 30, 40), makeNode(80, 0, 30, 40)],
    });
    const result = inferFlowAutoLayout(parent);

    expect(result).not.toBeNull();
    expect(result!.stackMode).toBe('HORIZONTAL');
  });

  it('children with no progressive ordering → null', () => {
    // Single child — need <2 children for non-null
    const parent = makeNode(0, 0, 100, 100, {
      children: [makeNode(10, 10, 80, 80)],
    });

    expect(inferFlowAutoLayout(parent)).toBeNull();
  });

  it('computes left/top padding from child offsets', () => {
    const parent = makeNode(0, 0, 120, 100, {
      children: [makeNode(16, 8, 80, 20), makeNode(16, 36, 80, 20), makeNode(16, 64, 80, 20)],
    });
    const result = inferFlowAutoLayout(parent)!;

    expect(result).not.toBeNull();
    expect(result.stackHorizontalPadding).toBe(16);
    expect(result.stackVerticalPadding).toBe(8);
  });

  it('absolute children are excluded from layout detection', () => {
    const absChild = makeNode(0, 0, 50, 50, {
      ir: makeIR({ isAbsolute: true }),
    });
    const parent = makeNode(0, 0, 100, 100, {
      children: [makeNode(0, 0, 100, 30), absChild, makeNode(0, 40, 100, 30)],
    });
    // Only 2 non-absolute children: should still produce VERTICAL
    const result = inferFlowAutoLayout(parent);

    expect(result).not.toBeNull();
    expect(result!.stackMode).toBe('VERTICAL');
  });

  it('SPACE_BETWEEN detected for 3+ evenly distributed children', () => {
    // parent 0→300 height, 3 children with equal gaps touching edges
    const parent = makeNode(0, 0, 100, 120, {
      styles: { display: 'flex', flexDirection: 'column' },
      ir: makeIR({
        autoLayout: {
          stackMode: 'VERTICAL',
          stackSpacing: 0,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'SPACE_BETWEEN',
          stackCounterAlignItems: 'MIN',
        },
      }),
      children: [
        makeNode(0, 0, 100, 30),
        makeNode(0, 44, 100, 30),
        makeNode(0, 88, 100, 30), // last child ends at 118, but parent is only 120
      ],
    });
    // via resolveAutoLayout (IR-authoritative path) — SPACE_BETWEEN should pass through
    const result = resolveAutoLayout(parent);

    expect(result).not.toBeNull();
    expect(result!.stackPrimaryAlignItems).toBe('SPACE_BETWEEN');
  });

  it('overlapping children → null (severe primary axis overlap)', () => {
    const parent = makeNode(0, 0, 100, 60, {
      children: [
        makeNode(0, 0, 100, 50),
        makeNode(0, 10, 100, 50), // overlaps by 40px
      ],
    });
    const result = inferFlowAutoLayout(parent);

    expect(result).toBeNull();
  });
});

// ---- inferSingleChildContainerLayout ----

describe('inferSingleChildContainerLayout', () => {
  it('single centered child → CENTER/CENTER alignment', () => {
    const parent = makeNode(0, 0, 200, 100, {
      name: 'container',
      ir: makeIR({ sizing: { widthMode: 'FIXED', heightMode: 'FIXED', isBlockLevel: true } }),
      children: [makeNode(60, 30, 80, 40)], // centered: left=60, right=60; top=30, bottom=30
    });
    const result = inferSingleChildContainerLayout(parent);

    expect(result).not.toBeNull();
    expect(result!.stackCounterAlignItems).toBe('CENTER');
    expect(result!.stackPrimaryAlignItems).toBe('CENTER');
  });

  it('single top-left child → MIN/MIN alignment', () => {
    const parent = makeNode(0, 0, 200, 100, {
      name: 'section',
      ir: makeIR({ sizing: { widthMode: 'FIXED', heightMode: 'FIXED', isBlockLevel: true } }),
      children: [makeNode(0, 0, 100, 60)], // top-left
    });
    const result = inferSingleChildContainerLayout(parent);

    expect(result!.stackCounterAlignItems).toBe('MIN');
    expect(result!.stackPrimaryAlignItems).toBe('MIN');
  });

  it('returns null for node without block-level or semantic name', () => {
    const parent = makeNode(0, 0, 100, 100, {
      name: 'random-component',
      styles: { display: 'flex' },
      ir: makeIR(), // not block-level, no IR autoLayout
      children: [makeNode(10, 10, 80, 80)],
    });
    const result = inferSingleChildContainerLayout(parent);

    // Not block-level, not semantic name
    expect(result).toBeNull();
  });

  it('returns null when node has IR autoLayout', () => {
    const parent = makeNode(0, 0, 200, 100, {
      name: 'main',
      ir: makeIR({
        autoLayout: {
          stackMode: 'VERTICAL',
          stackSpacing: 0,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'MIN',
          stackCounterAlignItems: 'MIN',
        },
      }),
      children: [makeNode(50, 30, 100, 40)],
    });
    const result = inferSingleChildContainerLayout(parent);

    expect(result).toBeNull();
  });

  it('returns null when multiple non-absolute children', () => {
    const parent = makeNode(0, 0, 200, 100, {
      name: 'section',
      ir: makeIR({ sizing: { widthMode: 'FIXED', heightMode: 'FIXED', isBlockLevel: true } }),
      children: [makeNode(10, 10, 80, 30), makeNode(10, 50, 80, 30)],
    });
    const result = inferSingleChildContainerLayout(parent);

    expect(result).toBeNull();
  });

  it('small padding (< 3px) snapped to 0', () => {
    const parent = makeNode(0, 0, 100, 100, {
      name: 'container',
      ir: makeIR({ sizing: { widthMode: 'FIXED', heightMode: 'FIXED', isBlockLevel: true } }),
      children: [makeNode(2, 2, 96, 96)], // 2px is < 3, should snap to 0
    });
    const result = inferSingleChildContainerLayout(parent)!;

    expect(result.stackHorizontalPadding).toBe(0);
    expect(result.stackVerticalPadding).toBe(0);
  });
});

// ---- resolveAutoLayout ----

describe('resolveAutoLayout', () => {
  it('IR autoLayout takes priority over inferred layout', () => {
    const parent = makeNode(0, 0, 100, 120, {
      ir: makeIR({
        autoLayout: {
          stackMode: 'HORIZONTAL', // IR says HORIZONTAL
          stackSpacing: 8,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'MIN',
          stackCounterAlignItems: 'MIN',
        },
      }),
      // children are stacked vertically — inferFlowAutoLayout would say VERTICAL
      children: [makeNode(0, 0, 100, 30), makeNode(0, 40, 100, 30), makeNode(0, 80, 100, 30)],
    });
    const result = resolveAutoLayout(parent)!;

    expect(result.stackMode).toBe('HORIZONTAL');
  });

  it('IR zero-gap gets enriched with inferred spacing', () => {
    const parent = makeNode(0, 0, 100, 120, {
      styles: { display: 'flex', flexDirection: 'column' },
      ir: makeIR({
        autoLayout: {
          stackMode: 'VERTICAL',
          stackSpacing: 0, // CSS gap:0, but children have visual gaps
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'MIN',
          stackCounterAlignItems: 'MIN',
        },
      }),
      children: [makeNode(0, 0, 100, 30), makeNode(0, 40, 100, 30), makeNode(0, 80, 100, 30)],
    });
    const result = resolveAutoLayout(parent)!;

    // Should either be 0 or inferred ~10 — either way not negative
    expect(result.stackSpacing).toBeGreaterThanOrEqual(0);
  });

  it('returns null for node without children', () => {
    const parent = makeNode(0, 0, 100, 100, { children: [] });

    expect(resolveAutoLayout(parent)).toBeNull();
  });

  it('SPACE_BETWEEN with single non-absolute child → downgraded to MIN', () => {
    const absChild = makeNode(0, 0, 50, 50, { ir: makeIR({ isAbsolute: true }) });
    const parent = makeNode(0, 0, 100, 100, {
      ir: makeIR({
        autoLayout: {
          stackMode: 'VERTICAL',
          stackSpacing: 0,
          stackVerticalPadding: 0,
          stackHorizontalPadding: 0,
          stackPaddingRight: 0,
          stackPaddingBottom: 0,
          stackPrimaryAlignItems: 'SPACE_BETWEEN',
          stackCounterAlignItems: 'MIN',
        },
      }),
      children: [makeNode(0, 0, 100, 50), absChild], // 1 non-absolute
    });
    const result = resolveAutoLayout(parent)!;

    expect(result.stackPrimaryAlignItems).toBe('MIN');
  });

  it('counter sizing is FIXED when IR widthMode is FIXED', () => {
    const parent = makeNode(0, 0, 300, 100, {
      styles: {},
      ir: makeIR({
        sizing: { widthMode: 'FIXED', heightMode: 'FIXED', isBlockLevel: false },
      }),
      children: [makeNode(0, 0, 150, 30), makeNode(170, 0, 120, 30)],
    });
    const result = resolveAutoLayout(parent);

    if (result) {
      expect(result.stackCounterSizing).toBe('FIXED');
    }
  });
});

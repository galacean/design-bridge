import { describe, it, expect, beforeEach } from 'vitest';
import {
  positionForIndex,
  buildGridStructures,
  parseGridPlacementHint,
  resolveGridPlacements,
  resetGridTrackIdCounter,
} from '@galacean/html2figma';
import type { SceneNode } from '@galacean/html2figma';
import { makeSceneNode } from '../helpers/scene-factories';

// ---- helpers ----

function makeChild(overrides: Partial<SceneNode> = {}): SceneNode {
  return makeSceneNode({
    name: 'Child',
    width: 50,
    height: 50,
    ...overrides,
  });
}

beforeEach(() => {
  resetGridTrackIdCounter();
});

// ---- positionForIndex ----

describe('positionForIndex', () => {
  it('index 0 → "!"', () => {
    expect(positionForIndex(0)).toBe('!');
  });

  it('index 1 → `"`', () => {
    expect(positionForIndex(1)).toBe('"');
  });

  it('index 93 → "~" (last single-char)', () => {
    expect(positionForIndex(93)).toBe('~');
  });

  it('index 94 → two-char sequence', () => {
    const val = positionForIndex(94);

    expect(val).toHaveLength(2);
  });

  it('index 94 starts at "!!" equivalent', () => {
    // hi=1, lo=0 → chr(0x22) + chr(0x21)
    const val = positionForIndex(94);

    expect(val.charCodeAt(0)).toBe(0x22);
    expect(val.charCodeAt(1)).toBe(0x21);
  });
});

// ---- buildGridStructures ----

describe('buildGridStructures', () => {
  it('2 cols × 2 rows → correct GUID counts', () => {
    const result = buildGridStructures([100, 100], [50, 50], 8, 8);

    expect(result._numCols).toBe(2);
    expect(result._numRows).toBe(2);
    expect(result._rowGUIDs).toHaveLength(2);
    expect(result._colGUIDs).toHaveLength(2);
  });

  it('gaps are preserved', () => {
    const result = buildGridStructures([50, 50, 50], [80], 12, 6);

    expect(result.gridColumnGap).toBe(12);
    expect(result.gridRowGap).toBe(6);
  });

  it('empty arrays fall back to 1×1', () => {
    const result = buildGridStructures([], [], 0, 0);

    expect(result._numCols).toBe(1);
    expect(result._numRows).toBe(1);
  });

  it('gridColumnsSizing entries use FLEX sizing', () => {
    const result = buildGridStructures([100, 200], [50], 0, 0);

    expect(result.gridColumnsSizing.entries).toHaveLength(2);
    expect(result.gridColumnsSizing.entries[0].trackSize.minSizing.type).toBe('FLEX');
  });

  it('gridRowsSizing entries use FIXED sizing with correct values', () => {
    const result = buildGridStructures([100], [40, 60], 0, 0);

    expect(result.gridRowsSizing.entries).toHaveLength(2);
    expect(result.gridRowsSizing.entries[0].trackSize.minSizing.type).toBe('FIXED');
    expect(result.gridRowsSizing.entries[0].trackSize.minSizing.value).toBe(40);
    expect(result.gridRowsSizing.entries[1].trackSize.minSizing.value).toBe(60);
  });

  it('position strings are contiguous ASCII', () => {
    const result = buildGridStructures([50, 50, 50], [50, 50], 0, 0);
    const colPositions = result.gridColumns.entries.map(e => e.position);

    expect(colPositions).toEqual(['!', '"', '#']);
  });
});

// ---- parseGridPlacementHint ----

describe('parseGridPlacementHint', () => {
  it('returns null col/row and span 1 when no grid styles', () => {
    const result = parseGridPlacementHint({});

    expect(result.col).toBeNull();
    expect(result.row).toBeNull();
    expect(result.colSpan).toBe(1);
    expect(result.rowSpan).toBe(1);
  });

  it('grid-column: "2" → col=1 (0-indexed)', () => {
    const result = parseGridPlacementHint({ gridColumn: '2' });

    expect(result.col).toBe(1);
    expect(result.colSpan).toBe(1);
  });

  it('grid-column: "1 / 3" → col=0, colSpan=2', () => {
    const result = parseGridPlacementHint({ gridColumn: '1 / 3' });

    expect(result.col).toBe(0);
    expect(result.colSpan).toBe(2);
  });

  it('grid-column: "span 2" → col=null, colSpan=2', () => {
    const result = parseGridPlacementHint({ gridColumn: 'span 2' });

    expect(result.col).toBeNull();
    expect(result.colSpan).toBe(2);
  });

  it('grid-column-start + grid-column-end → correct span', () => {
    const result = parseGridPlacementHint({ gridColumnStart: '2', gridColumnEnd: '4' });

    expect(result.col).toBe(1);
    expect(result.colSpan).toBe(2);
  });

  it('grid-row: "1 / 3" → row=0, rowSpan=2', () => {
    const result = parseGridPlacementHint({ gridRow: '1 / 3' });

    expect(result.row).toBe(0);
    expect(result.rowSpan).toBe(2);
  });

  it('auto values → null', () => {
    const result = parseGridPlacementHint({ gridColumn: 'auto', gridRow: 'auto' });

    expect(result.col).toBeNull();
    expect(result.row).toBeNull();
  });

  it('span in end part → colSpan resolved', () => {
    const result = parseGridPlacementHint({ gridColumn: '2 / span 3' });

    expect(result.col).toBe(1);
    expect(result.colSpan).toBe(3);
  });
});

// ---- resolveGridPlacements ----

describe('resolveGridPlacements', () => {
  it('4 items, 2 cols → 2 rows auto-placed', () => {
    const children = [
      makeChild({ x: 0, y: 0 }),
      makeChild({ x: 50, y: 0 }),
      makeChild({ x: 0, y: 50 }),
      makeChild({ x: 50, y: 50 }),
    ];
    const placements = resolveGridPlacements(children, 2);

    expect(placements[0]).toEqual({ row: 0, col: 0, rowSpan: 1, colSpan: 1 });
    expect(placements[1]).toEqual({ row: 0, col: 1, rowSpan: 1, colSpan: 1 });
    expect(placements[2]).toEqual({ row: 1, col: 0, rowSpan: 1, colSpan: 1 });
    expect(placements[3]).toEqual({ row: 1, col: 1, rowSpan: 1, colSpan: 1 });
  });

  it('absolute child → placement is null', () => {
    const children = [
      makeChild({
        ir: {
          figmaType: 'FRAME',
          opacity: 1,
          isAbsolute: true,
          fills: [],
          effects: [],
          clipsContent: false,
          flexGrow: 0,
        },
      }),
      makeChild(),
    ];
    const placements = resolveGridPlacements(children, 2);

    expect(placements[0]).toBeNull();
    expect(placements[1]).not.toBeNull();
  });

  it('colSpan=2 in 2-col grid → occupies whole row, next item goes to row 1', () => {
    const wideChild = makeChild({
      styles: { gridColumn: '1 / 3' },
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
        gridPlacement: { row: null, col: 0, rowSpan: 1, colSpan: 2 },
      },
    });
    const normalChild = makeChild();
    const placements = resolveGridPlacements([wideChild, normalChild], 2);

    expect(placements[0]).toEqual({ row: 0, col: 0, rowSpan: 1, colSpan: 2 });
    expect(placements[1]?.row).toBe(1);
    expect(placements[1]?.col).toBe(0);
  });

  it('explicit row+col placement respected', () => {
    const child = makeChild({
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
        gridPlacement: { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
      },
    });
    const placements = resolveGridPlacements([child], 3);

    expect(placements[0]).toEqual({ row: 1, col: 1, rowSpan: 1, colSpan: 1 });
  });

  it('numCols=1 → all items stack vertically', () => {
    const children = [makeChild(), makeChild(), makeChild()];
    const placements = resolveGridPlacements(children, 1);

    expect(placements[0]?.row).toBe(0);
    expect(placements[1]?.row).toBe(1);
    expect(placements[2]?.row).toBe(2);
    expect(placements.every(p => p?.col === 0)).toBe(true);
  });

  it('3 items, 3 cols → all in row 0', () => {
    const children = [makeChild(), makeChild(), makeChild()];
    const placements = resolveGridPlacements(children, 3);

    expect(placements[0]).toEqual({ row: 0, col: 0, rowSpan: 1, colSpan: 1 });
    expect(placements[1]).toEqual({ row: 0, col: 1, rowSpan: 1, colSpan: 1 });
    expect(placements[2]).toEqual({ row: 0, col: 2, rowSpan: 1, colSpan: 1 });
  });

  it('col-only hint → auto-row assigned', () => {
    const child = makeChild({
      ir: {
        figmaType: 'FRAME',
        opacity: 1,
        isAbsolute: false,
        fills: [],
        effects: [],
        clipsContent: false,
        flexGrow: 0,
        gridPlacement: { row: null, col: 1, rowSpan: 1, colSpan: 1 },
      },
    });
    const placements = resolveGridPlacements([child], 3);

    expect(placements[0]?.col).toBe(1);
    expect(placements[0]?.row).toBe(0);
  });
});

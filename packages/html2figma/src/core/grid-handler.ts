import type { SceneNode, SceneStyles, FigmaGUID } from '../types';

// ---- Grid track GUID generation ----
let gridTrackIdCounter = 0;

export function resetGridTrackIdCounter(): void {
  gridTrackIdCounter = 0;
}

function makeGridTrackGUID(): FigmaGUID {
  return { sessionID: 100, localID: gridTrackIdCounter++ };
}

export function positionForIndex(i: number): string {
  if (i < 94) {
    return String.fromCharCode(0x21 + i);
  }
  const hi = Math.floor(i / 94);
  const lo = i % 94;

  return String.fromCharCode(0x21 + hi) + String.fromCharCode(0x21 + lo);
}

export function buildGridStructures(gridCols: number[], gridRows: number[], colGap: number, rowGap: number) {
  const numCols = gridCols.length || 1;
  const numRows = gridRows.length || 1;

  const rowGUIDs: FigmaGUID[] = [];

  for (let i = 0; i < numRows; i++) {
    rowGUIDs.push(makeGridTrackGUID());
  }
  const colGUIDs: FigmaGUID[] = [];

  for (let i = 0; i < numCols; i++) {
    colGUIDs.push(makeGridTrackGUID());
  }

  const gridRowsMap = {
    entries: rowGUIDs.map((guid, i) => ({
      id: guid,
      position: positionForIndex(i),
    })),
  };

  const gridColumnsMap = {
    entries: colGUIDs.map((guid, i) => ({
      id: guid,
      position: positionForIndex(i),
    })),
  };

  const gridColumnsSizing = {
    entries: colGUIDs.map(guid => ({
      id: guid,
      trackSize: {
        minSizing: { type: 'FLEX', value: 1 },
        maxSizing: { type: 'FLEX', value: 1 },
      },
    })),
  };

  const gridRowsSizing = {
    entries: rowGUIDs.map((guid, i) => ({
      id: guid,
      trackSize: {
        minSizing: { type: 'FIXED', value: gridRows[i] || 0 },
        maxSizing: { type: 'FIXED', value: gridRows[i] || 0 },
      },
    })),
  };

  return {
    gridRows: gridRowsMap,
    gridColumns: gridColumnsMap,
    gridRowGap: rowGap,
    gridColumnGap: colGap,
    gridColumnsSizing,
    gridRowsSizing,
    _rowGUIDs: rowGUIDs,
    _colGUIDs: colGUIDs,
    _numCols: numCols,
    _numRows: numRows,
  };
}

// ---- Grid placement ----

export type GridPlacement = { row: number; col: number; rowSpan: number; colSpan: number };
type GridPlacementHint = {
  row: number | null;
  col: number | null;
  rowSpan: number;
  colSpan: number;
};

function parseGridLineStart(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const v = value.trim().toLowerCase();

  if (!v || v === 'auto') {
    return null;
  }
  const n = parseInt(v, 10);

  if (!Number.isFinite(n)) {
    return null;
  }

  return Math.max(n - 1, 0);
}

function parseGridSpan(value: string | undefined): number {
  if (!value) {
    return 1;
  }
  const match = value.match(/span\s+(\d+)/i);

  if (!match) {
    return 1;
  }
  const parsed = parseInt(match[1], 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function parseGridPlacementHint(styles: SceneStyles): GridPlacementHint {
  let col = parseGridLineStart(styles.gridColumnStart);
  let row = parseGridLineStart(styles.gridRowStart);
  let colSpan = parseGridSpan(styles.gridColumn);
  let rowSpan = parseGridSpan(styles.gridRow);

  const colShorthand = (styles.gridColumn || '').trim();

  if (colShorthand) {
    const parts = colShorthand.split('/').map(p => p.trim());

    if (parts.length > 0 && col === null) {
      const parsedStart = parseGridLineStart(parts[0]);

      if (parsedStart !== null) {
        col = parsedStart;
      }
    }
    if (parts.length > 1) {
      const endPart = parts[1];
      const endStart = parseGridLineStart(endPart);

      if (endStart !== null && col !== null) {
        colSpan = Math.max(endStart - col, 1);
      } else {
        colSpan = Math.max(colSpan, parseGridSpan(endPart));
      }
    }
  }

  const rowShorthand = (styles.gridRow || '').trim();

  if (rowShorthand) {
    const parts = rowShorthand.split('/').map(p => p.trim());

    if (parts.length > 0 && row === null) {
      const parsedStart = parseGridLineStart(parts[0]);

      if (parsedStart !== null) {
        row = parsedStart;
      }
    }
    if (parts.length > 1) {
      const endPart = parts[1];
      const endStart = parseGridLineStart(endPart);

      if (endStart !== null && row !== null) {
        rowSpan = Math.max(endStart - row, 1);
      } else {
        rowSpan = Math.max(rowSpan, parseGridSpan(endPart));
      }
    }
  }

  if (styles.gridColumnEnd) {
    const colEnd = parseGridLineStart(styles.gridColumnEnd);

    if (colEnd !== null && col !== null) {
      colSpan = Math.max(colEnd - col, 1);
    } else {
      colSpan = Math.max(colSpan, parseGridSpan(styles.gridColumnEnd));
    }
  }

  if (styles.gridRowEnd) {
    const rowEnd = parseGridLineStart(styles.gridRowEnd);

    if (rowEnd !== null && row !== null) {
      rowSpan = Math.max(rowEnd - row, 1);
    } else {
      rowSpan = Math.max(rowSpan, parseGridSpan(styles.gridRowEnd));
    }
  }

  return {
    row: row !== null ? Math.max(row, 0) : null,
    col: col !== null ? Math.max(col, 0) : null,
    rowSpan: Math.max(rowSpan, 1),
    colSpan: Math.max(colSpan, 1),
  };
}

function makeGridCellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function canPlaceGridArea(
  occupied: Set<string>,
  row: number,
  col: number,
  rowSpan: number,
  colSpan: number,
  numCols: number,
): boolean {
  if (col < 0 || col + colSpan > numCols) {
    return false;
  }
  for (let r = row; r < row + rowSpan; r++) {
    for (let c = col; c < col + colSpan; c++) {
      if (occupied.has(makeGridCellKey(r, c))) {
        return false;
      }
    }
  }

  return true;
}

function markGridAreaOccupied(occupied: Set<string>, row: number, col: number, rowSpan: number, colSpan: number): void {
  for (let r = row; r < row + rowSpan; r++) {
    for (let c = col; c < col + colSpan; c++) {
      occupied.add(makeGridCellKey(r, c));
    }
  }
}

export function resolveGridPlacements(children: SceneNode[], numCols: number): Array<GridPlacement | null> {
  const normalizedCols = Math.max(numCols, 1);
  const placements: Array<GridPlacement | null> = new Array(children.length).fill(null) as Array<GridPlacement | null>;
  const occupied = new Set<string>();
  let autoCursorRow = 0;
  let autoCursorCol = 0;

  const findFirstFreeInRow = (row: number, rowSpan: number, colSpan: number): number => {
    for (let col = 0; col + colSpan <= normalizedCols; col++) {
      if (canPlaceGridArea(occupied, row, col, rowSpan, colSpan, normalizedCols)) {
        return col;
      }
    }

    return -1;
  };

  const findFirstFreeInColumn = (col: number, rowSpan: number, colSpan: number): number => {
    let row = 0;

    while (row < 10000) {
      if (canPlaceGridArea(occupied, row, col, rowSpan, colSpan, normalizedCols)) {
        return row;
      }
      row += 1;
    }

    return 0;
  };

  const findFirstAutoPlacement = (rowSpan: number, colSpan: number): { row: number; col: number } => {
    let row = autoCursorRow;

    while (row < 10000) {
      const startCol = row === autoCursorRow ? autoCursorCol : 0;

      for (let col = startCol; col + colSpan <= normalizedCols; col++) {
        if (canPlaceGridArea(occupied, row, col, rowSpan, colSpan, normalizedCols)) {
          return { row, col };
        }
      }
      row += 1;
    }

    return { row: 0, col: 0 };
  };

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const isAbsoluteChild = !!child.ir?.isAbsolute;

    if (isAbsoluteChild) {
      placements[i] = null;
      continue;
    }

    const hint = child.ir?.gridPlacement || parseGridPlacementHint(child.styles || {});
    const rowSpan = Math.max(hint.rowSpan, 1);
    const colSpan = Math.max(Math.min(hint.colSpan, normalizedCols), 1);

    let row: number;
    let col: number;

    if (hint.row !== null && hint.col !== null) {
      row = hint.row;
      col = Math.min(hint.col, normalizedCols - colSpan);
      while (!canPlaceGridArea(occupied, row, col, rowSpan, colSpan, normalizedCols)) {
        row += 1;
      }
    } else if (hint.row !== null) {
      row = hint.row;
      let candidateCol = findFirstFreeInRow(row, rowSpan, colSpan);

      while (candidateCol < 0) {
        row += 1;
        candidateCol = findFirstFreeInRow(row, rowSpan, colSpan);
      }
      col = candidateCol;
    } else if (hint.col !== null) {
      col = Math.min(hint.col, normalizedCols - colSpan);
      row = findFirstFreeInColumn(col, rowSpan, colSpan);
    } else {
      const autoPos = findFirstAutoPlacement(rowSpan, colSpan);

      row = autoPos.row;
      col = autoPos.col;
    }

    markGridAreaOccupied(occupied, row, col, rowSpan, colSpan);
    placements[i] = { row, col, rowSpan, colSpan };

    autoCursorRow = row;
    autoCursorCol = col + colSpan;
    while (autoCursorCol >= normalizedCols) {
      autoCursorRow += 1;
      autoCursorCol -= normalizedCols;
    }
  }

  return placements;
}

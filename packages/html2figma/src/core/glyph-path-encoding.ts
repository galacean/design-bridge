import type * as fontkit from 'fontkit';

function appendFloat32LE(target: number[], value: number): void {
  const buffer = new ArrayBuffer(4);

  const view = new DataView(buffer);

  view.setFloat32(0, value, true);
  // Read explicit bytes: loose-mode bundlers can compile TypedArray spread as concat.
  for (let index = 0; index < 4; index++) {
    target.push(view.getUint8(index));
  }
}

function appendPoint(target: number[], x: number, y: number, unitsPerEm: number): void {
  appendFloat32LE(target, x / unitsPerEm);
  appendFloat32LE(target, y / unitsPerEm);
}

function appendQuadratic(target: number[], cx: number, cy: number, ex: number, ey: number, unitsPerEm: number): void {
  target.push(3);
  appendPoint(target, cx, cy, unitsPerEm);
  appendPoint(target, ex, ey, unitsPerEm);
}

function splitGlyphPathContours(glyphPath: fontkit.Path): Array<Array<{ command: string; args: number[] }>> {
  const commands = Array.isArray(glyphPath?.commands) ? glyphPath.commands : [];
  const contours: Array<Array<{ command: string; args: number[] }>> = [];
  let currentContour: Array<{ command: string; args: number[] }> = [];

  for (const command of commands) {
    if (typeof command.command !== 'string') {
      continue;
    }
    if (command.command === 'moveTo') {
      if (currentContour.length) {
        contours.push(currentContour);
      }
      currentContour = [command];
      continue;
    }

    if (!currentContour.length) {
      currentContour = [{ command: 'moveTo', args: [0, 0] }];
    }

    currentContour.push(command);

    if (command.command === 'closePath') {
      contours.push(currentContour);
      currentContour = [];
    }
  }

  if (currentContour.length) {
    contours.push(currentContour);
  }

  return contours;
}

function expandQCurvePoints(
  points: number[],
  startX: number,
  startY: number,
): Array<{ cx: number; cy: number; ex: number; ey: number }> {
  const pairs: Array<{ x: number; y: number }> = [];

  for (let i = 0; i + 1 < points.length; i += 2) {
    pairs.push({ x: points[i], y: points[i + 1] });
  }
  if (pairs.length === 0) {
    return [];
  }

  const segments: Array<{ cx: number; cy: number; ex: number; ey: number }> = [];
  let currentX = startX;
  let currentY = startY;

  for (let i = 0; i < pairs.length; i++) {
    const control = pairs[i];
    const next = i + 1 < pairs.length ? pairs[i + 1] : undefined;

    if (next !== undefined) {
      const impliedEndX = (control.x + next.x) / 2;
      const impliedEndY = (control.y + next.y) / 2;

      segments.push({ cx: control.x, cy: control.y, ex: impliedEndX, ey: impliedEndY });
      currentX = impliedEndX;
      currentY = impliedEndY;
    } else {
      segments.push({ cx: control.x, cy: control.y, ex: control.x, ey: control.y });
      currentX = control.x;
      currentY = control.y;
    }
  }

  if (segments.length > 0) {
    const last = segments[segments.length - 1];

    if (last.ex !== currentX || last.ey !== currentY) {
      segments[segments.length - 1] = { ...last, ex: currentX, ey: currentY };
    }
  }

  return segments;
}

export function encodeGlyphCommandsBlob(glyphPath: fontkit.Path, unitsPerEm: number): Uint8Array {
  const contours = splitGlyphPathContours(glyphPath);

  if (contours.length === 0) {
    return Uint8Array.from([0]);
  }

  const bytes: number[] = [];

  for (let contourIndex = 0; contourIndex < contours.length; contourIndex++) {
    const contour = contours[contourIndex];
    const start = contour[0];

    if (start.command !== 'moveTo') {
      continue;
    }

    bytes.push(0, 1);
    const startX = start.args[0] || 0;
    const startY = start.args[1] || 0;

    appendPoint(bytes, startX, startY, unitsPerEm);

    let currentX = startX;
    let currentY = startY;
    let hasClosePath = false;

    for (let i = 1; i < contour.length; i++) {
      const command = contour[i];
      const args = Array.isArray(command.args) ? command.args : [];

      if (command.command === 'lineTo') {
        bytes.push(2);
        currentX = args[0] || 0;
        currentY = args[1] || 0;
        appendPoint(bytes, currentX, currentY, unitsPerEm);
        continue;
      }

      if ((command.command === 'curveTo' || command.command === 'bezierCurveTo') && args.length >= 6) {
        bytes.push(4);
        appendPoint(bytes, args[0] || 0, args[1] || 0, unitsPerEm);
        appendPoint(bytes, args[2] || 0, args[3] || 0, unitsPerEm);
        currentX = args[4] || 0;
        currentY = args[5] || 0;
        appendPoint(bytes, currentX, currentY, unitsPerEm);
        continue;
      }

      if (
        (command.command === 'quadTo' || command.command === 'qCurveTo' || command.command === 'quadraticCurveTo') &&
        args.length >= 4
      ) {
        if (command.command === 'quadTo' || command.command === 'quadraticCurveTo') {
          const controlX = args[0] || 0;
          const controlY = args[1] || 0;
          const endX = args[2] || 0;
          const endY = args[3] || 0;

          appendQuadratic(bytes, controlX, controlY, endX, endY, unitsPerEm);
          currentX = endX;
          currentY = endY;
          continue;
        }

        const segments = expandQCurvePoints(args, currentX, currentY);

        for (const segment of segments) {
          appendQuadratic(bytes, segment.cx, segment.cy, segment.ex, segment.ey, unitsPerEm);
          currentX = segment.ex;
          currentY = segment.ey;
        }
        continue;
      }

      if (command.command === 'closePath') {
        hasClosePath = true;
      }
    }

    if (hasClosePath && (currentX !== startX || currentY !== startY)) {
      bytes.push(2);
      appendPoint(bytes, startX, startY, unitsPerEm);
    }
    if (hasClosePath && contourIndex === contours.length - 1) {
      bytes.push(0);
    }
  }

  return Uint8Array.from(bytes);
}

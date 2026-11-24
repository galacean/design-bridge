import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { convertFigmaToEffects, decodeFigFile, extractKiwiIR } from '@galacean/figma2ge';
import type { FigmaIRNode } from '@galacean/figma2ge';

// ItemType enum name lookup (values from @galacean/effects spec)
const ITEM_TYPE_NAMES: Record<number, string> = {
  0: 'null',
  1: 'sprite',
  2: 'particle',
  3: 'null',
  4: 'plugin',
  5: 'camera',
  6: 'text',
  7: 'shape',
  8: 'interact',
};

function getItemTypeName(typeVal: unknown): string {
  if (typeof typeVal === 'number') {
    return ITEM_TYPE_NAMES[typeVal] ?? `unknown(${typeVal})`;
  }
  if (typeof typeVal === 'string') {
    return typeVal;
  }

  return `unknown(${String(typeVal)})`;
}

describe('debug baseline-custom.fig', () => {
  it('converts and logs detailed diagnostic info', () => {
    const figRaw = readFileSync(resolve(__dirname, './fixtures/baseline-custom.fig'));
    const figBytes = new Uint8Array(figRaw.buffer, figRaw.byteOffset, figRaw.byteLength);

    const { message, images } = decodeFigFile(figBytes);

    // ──────────────────────────────────────────────────────────
    // SECTION 0: IR TREE (intermediate representation)
    // ──────────────────────────────────────────────────────────
    const { nodes: irNodes, blobs } = extractKiwiIR(message);

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                     IR TREE                            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`Total IR root nodes: ${irNodes.length}`);
    console.log(`Total blobs: ${blobs.length}`);

    function printIRNode(node: FigmaIRNode, depth: number): void {
      const indent = '  '.repeat(depth);
      const fillsCount = node.fills?.length ?? 0;
      const strokesCount = node.strokes?.length ?? 0;
      const effectsCount = node.effects?.length ?? 0;

      console.log(`${indent}[IR] id="${node.id}" name="${node.name}" figmaType=${node.figmaType} kind=${node.kind}`);
      console.log(
        `${indent}     x=${node.x.toFixed(1)} y=${node.y.toFixed(1)} w=${node.width.toFixed(1)} h=${node.height.toFixed(1)}`,
      );
      console.log(
        `${indent}     opacity=${node.opacity} visible=${node.visible} rotation=${node.rotation ?? 'none'} blendMode=${node.blendMode ?? 'none'}`,
      );
      console.log(
        `${indent}     fills=${fillsCount} strokes=${strokesCount} effects=${effectsCount} children=${node.children.length}`,
      );

      // Print fill details
      if (node.fills && node.fills.length > 0) {
        for (let i = 0; i < node.fills.length; i++) {
          const f = node.fills[i];
          let detail = `type=${f.type} visible=${f.visible ?? true} opacity=${f.opacity ?? 1}`;

          if (f.type === 'solid' && f.color) {
            detail += ` color=[${f.color.map(c => c.toFixed(3)).join(', ')}]`;
          } else if (f.type === 'gradient' && f.gradient) {
            detail += ` gradientType=${f.gradient.type} stops=${f.gradient.stops.length}`;
          } else if (f.type === 'image') {
            detail += ` imageRef=${f.imageRef} scaleMode=${f.imageScaleMode ?? 'none'} blobIndex=${f.dataBlobIndex ?? 'none'}`;
          }
          console.log(`${indent}     fill[${i}]: ${detail}`);
        }
      }

      // Print convenience color fields
      if (node.fillColor) {
        console.log(`${indent}     fillColor=[${node.fillColor.map(c => c.toFixed(3)).join(', ')}]`);
      }
      if (node.textColor) {
        console.log(`${indent}     textColor=[${node.textColor.map(c => c.toFixed(3)).join(', ')}]`);
      }
      if (node.strokeColor) {
        console.log(
          `${indent}     strokeColor=[${node.strokeColor.map(c => c.toFixed(3)).join(', ')}] strokeWidth=${node.strokeWidth}`,
        );
      }
      if (node.imageRef) {
        console.log(`${indent}     imageRef=${node.imageRef} imageBlobIndex=${node.imageBlobIndex}`);
      }

      // Print text details
      if (node.kind === 'text') {
        console.log(
          `${indent}     text="${node.text ?? ''}" fontSize=${node.textFontSize} fontWeight=${node.textFontWeight} fontFamily="${node.textFontFamily}"`,
        );
        console.log(
          `${indent}     lineHeight=${node.textLineHeight} letterSpacing=${node.letterSpacing} alignH=${node.textAlignHorizontal} alignV=${node.textAlignVertical} decoration=${node.textDecoration}`,
        );
      }

      // Print shape-specific
      if (node.cornerRadius !== undefined) {
        console.log(`${indent}     cornerRadius=${node.cornerRadius}`);
      }
      if (node.cornerRadii) {
        console.log(`${indent}     cornerRadii=[${node.cornerRadii.join(', ')}]`);
      }
      if (node.shapePointCount !== undefined) {
        console.log(`${indent}     shapePointCount=${node.shapePointCount}`);
      }
      if (node.starInnerScale !== undefined) {
        console.log(`${indent}     starInnerScale=${node.starInnerScale}`);
      }
      if (node.arcData) {
        console.log(
          `${indent}     arcData: startAngle=${node.arcData.startingAngle} endAngle=${node.arcData.endingAngle} innerRadius=${node.arcData.innerRadius}`,
        );
      }

      // Print stroke details
      if (node.strokes && node.strokes.length > 0) {
        for (let i = 0; i < node.strokes.length; i++) {
          const s = node.strokes[i];
          let detail = `type=${s.type} visible=${s.visible ?? true} width=${s.width} align=${s.align ?? 'none'}`;

          if (s.type === 'solid' && s.color) {
            detail += ` color=[${s.color.map(c => c.toFixed(3)).join(', ')}]`;
          } else if (s.type === 'gradient' && s.gradient) {
            detail += ` gradientType=${s.gradient.type} stops=${s.gradient.stops.length}`;
          }
          if (s.cap) {
            detail += ` cap=${s.cap}`;
          }
          if (s.join) {
            detail += ` join=${s.join}`;
          }
          if (s.dashPattern) {
            detail += ` dash=[${s.dashPattern.join(',')}]`;
          }
          console.log(`${indent}     stroke[${i}]: ${detail}`);
        }
      }

      // Print auto-layout
      if (node.autoLayout) {
        const al = node.autoLayout;

        console.log(
          `${indent}     autoLayout: dir=${al.direction} spacing=${al.spacing} padding=[${al.paddingTop},${al.paddingRight},${al.paddingBottom},${al.paddingLeft}] primary=${al.primaryAlign} counter=${al.counterAlign} wrap=${al.wrap ?? false}`,
        );
      }

      // Recurse into children
      for (const child of node.children) {
        printIRNode(child, depth + 1);
      }
    }

    for (const rootNode of irNodes) {
      printIRNode(rootNode, 0);
    }

    // ──────────────────────────────────────────────────────────
    // SECTION 1: SCENE OUTPUT
    // ──────────────────────────────────────────────────────────
    const result = convertFigmaToEffects(message, {}, images);
    const { scene, issues, debugMap } = result;

    // Build a lookup: itemId → item for parentId resolution
    const itemById = new Map<string, Record<string, unknown>>();

    for (const item of scene.items) {
      itemById.set(item.id, item as unknown as Record<string, unknown>);
    }

    // --- Items ---
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                      ITEMS                              ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`Total items: ${scene.items.length}`);
    for (const item of scene.items) {
      const rec = item as unknown as Record<string, unknown>;
      const transform = rec.transform as Record<string, unknown> | undefined;
      const position = transform?.position as Record<string, unknown> | undefined;
      const size = transform?.size as Record<string, unknown> | undefined;
      const eulerHint = transform?.eulerHint as Record<string, unknown> | undefined;
      const parentId = rec.parentId as string | undefined;
      const parentItem = parentId ? itemById.get(parentId) : undefined;
      const parentName = parentItem ? (parentItem.name as string) : undefined;
      const componentRefs = rec.components as Array<{ id: string }> | undefined;
      const visible = rec.visible;
      const content = rec.content as Record<string, unknown> | undefined;
      const contentOptions = content?.options as Record<string, unknown> | undefined;

      console.log(`  [Item] id=${rec.id} name="${rec.name}" type=${getItemTypeName(rec.type)} (raw=${rec.type})`);
      console.log(`    parentId: ${parentId ? 'YES → ' + parentId + ' ("' + (parentName ?? '?') + '")' : 'NO (root)'}`);
      if (position) {
        console.log(
          `    position: x=${Number(position.x).toFixed(4)} y=${Number(position.y).toFixed(4)} z=${Number(position.z).toFixed(4)}`,
        );
      }
      if (size) {
        console.log(`    size: x=${Number(size.x).toFixed(4)} y=${Number(size.y).toFixed(4)}`);
      }
      if (eulerHint) {
        console.log(
          `    eulerHint: x=${Number(eulerHint.x).toFixed(4)} y=${Number(eulerHint.y).toFixed(4)} z=${Number(eulerHint.z).toFixed(4)}`,
        );
      }
      console.log(`    visible=${visible} components=${componentRefs?.length ?? 0}`);
      if (contentOptions && Object.keys(contentOptions).length > 0) {
        console.log(`    content.options: ${JSON.stringify(contentOptions)}`);
      } else {
        console.log('    content.options: (empty)');
      }
    }

    // --- Compositions ---
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                   COMPOSITIONS                         ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    if (scene.compositions) {
      for (let ci = 0; ci < scene.compositions.length; ci++) {
        const comp = scene.compositions[ci];
        const c = comp as unknown as Record<string, unknown>;

        console.log(`  [Composition ${ci}] id=${c.id} name="${c.name}" duration=${c.duration}`);
        console.log(`    startTime=${c.startTime} endBehavior=${c.endBehavior}`);
        if (c.previewSize) {
          console.log(`    previewSize: ${JSON.stringify(c.previewSize)}`);
        }
        if (c.camera) {
          const cam = c.camera as Record<string, unknown>;

          console.log(
            `    camera.fov=${cam.fov} camera.far=${cam.far} camera.near=${cam.near} camera.clipMode=${cam.clipMode}`,
          );
          console.log(`    camera.position=${JSON.stringify(cam.position)}`);
          console.log(`    camera.rotation=${JSON.stringify(cam.rotation)}`);
        }
        if (c.items) {
          const itemsArr = c.items as Array<{ id: string }>;

          console.log(`    items refs (${itemsArr.length}):`);
          for (const ref of itemsArr) {
            const refItem = itemById.get(ref.id);
            const refName = refItem ? (refItem.name as string) : '?';

            console.log(`      → ${ref.id} ("${refName}")`);
          }
        }
        if (c.components) {
          console.log(`    composition.components: ${JSON.stringify(c.components)}`);
        }
        // Dump all remaining keys for completeness
        const knownKeys = new Set([
          'id',
          'name',
          'duration',
          'startTime',
          'endBehavior',
          'previewSize',
          'camera',
          'items',
          'components',
        ]);
        const extraKeys = Object.keys(c).filter(k => !knownKeys.has(k));

        if (extraKeys.length > 0) {
          for (const ek of extraKeys) {
            console.log(`    ${ek}: ${JSON.stringify(c[ek])}`);
          }
        }
      }
    } else {
      console.log('  (no compositions)');
    }

    // --- Components ---
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                    COMPONENTS                          ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`Total components: ${scene.components.length}`);
    for (const comp of scene.components) {
      const c = comp as unknown as Record<string, unknown>;
      const itemRef = c.item as { id: string } | undefined;
      const itemName = itemRef ? ((itemById.get(itemRef.id)?.name as string) ?? '?') : 'N/A';

      console.log(
        `  [Component] id=${c.id} dataType=${JSON.stringify(c.dataType)} → item="${itemName}" (${itemRef?.id ?? 'N/A'})`,
      );

      // SpriteComponent
      if (c.dataType === 'SpriteComponent') {
        const opts = c.options as Record<string, unknown> | undefined;
        const renderer = c.renderer as Record<string, unknown> | undefined;

        console.log(`    startColor: ${JSON.stringify(opts?.startColor)}`);
        console.log(
          `    opacity info: startColor[3]=${Array.isArray(opts?.startColor) ? (opts?.startColor as number[])[3] : 'N/A'}`,
        );
        console.log(`    textureId: ${renderer?.texture ? JSON.stringify(renderer.texture) : 'none'}`);
        console.log(`    blendMode (blending): ${renderer?.blending ?? 0}`);
        if (opts?.gradient) {
          console.log(`    gradient: ${JSON.stringify(opts.gradient)}`);
        }
        if (opts?.strokeColor) {
          console.log(`    strokeColor: ${JSON.stringify(opts.strokeColor)}`);
        }
        if (opts?.strokeWidth) {
          console.log(`    strokeWidth: ${opts.strokeWidth}`);
        }
        if (opts?.fills) {
          console.log(`    fills: ${JSON.stringify(opts.fills)}`);
        }
        if (opts?.additionalFills) {
          console.log(`    additionalFills: ${JSON.stringify(opts.additionalFills)}`);
        }
        if (opts?.imageScaleMode) {
          console.log(`    imageScaleMode: ${opts.imageScaleMode}`);
        }
      }

      // ShapeComponent
      if (c.dataType === 'ShapeComponent') {
        console.log(`    shape.type: ${c.type}`);
        // Fills
        const fills = c.fills as Array<Record<string, unknown>> | undefined;

        if (fills && fills.length > 0) {
          for (let i = 0; i < fills.length; i++) {
            const f = fills[i];

            console.log(
              `    fill[${i}]: type=${f.type} color=${JSON.stringify(f.color)} gradientStops=${f.gradientStops ? JSON.stringify(f.gradientStops) : 'none'}`,
            );
          }
        } else {
          console.log('    fills: (empty)');
        }
        // Strokes
        const strokes = c.strokes as Array<Record<string, unknown>> | undefined;

        if (strokes && strokes.length > 0) {
          for (let i = 0; i < strokes.length; i++) {
            const s = strokes[i];

            console.log(`    stroke[${i}]: type=${s.type} color=${JSON.stringify(s.color)} width=${c.strokeWidth}`);
          }
        } else {
          console.log('    strokes: (empty)');
        }
        // Dimensions (vary by shape type)
        if (c.width !== undefined) {
          console.log(`    width=${c.width} height=${c.height} roundness=${c.roundness}`);
        }
        if (c.xRadius !== undefined) {
          console.log(`    xRadius=${c.xRadius} yRadius=${c.yRadius}`);
        }
        if (c.pointCount !== undefined) {
          console.log(`    pointCount=${c.pointCount}`);
        }
        if (c.radius !== undefined) {
          console.log(`    radius=${c.radius}`);
        }
        if (c.outerRadius !== undefined) {
          console.log(
            `    outerRadius=${c.outerRadius} innerRadius=${c.innerRadius} outerRoundness=${c.outerRoundness} innerRoundness=${c.innerRoundness}`,
          );
        }
        if (c.strokeCap !== undefined) {
          console.log(`    strokeCap=${c.strokeCap} strokeJoin=${c.strokeJoin}`);
        }
        if (c.renderer) {
          console.log(`    renderer (blending): ${JSON.stringify(c.renderer)}`);
        }
      }

      // TextComponent
      if (c.dataType === 'TextComponent') {
        const opts = c.options as Record<string, unknown> | undefined;

        console.log(`    text: "${opts?.text ?? ''}"`);
        console.log(`    fontSize: ${opts?.fontSize}`);
        console.log(`    fontWeight: ${opts?.fontWeight ?? 'unset'}`);
        console.log(`    fontFamily: "${opts?.fontFamily}"`);
        console.log(`    textColor: ${JSON.stringify(opts?.textColor)}`);
        console.log(`    textWidth: ${opts?.textWidth} textHeight: ${opts?.textHeight}`);
        console.log(`    lineHeight: ${opts?.lineHeight} letterSpacing: ${opts?.letterSpacing ?? 'unset'}`);
        console.log(`    textAlign: ${opts?.textAlign ?? 'unset'} verticalAlign: ${opts?.verticalAlign ?? 'unset'}`);
        console.log(`    textDecoration: ${opts?.textDecoration ?? 'none'}`);
        const renderer = c.renderer as Record<string, unknown> | undefined;

        if (renderer?.blending) {
          console.log(`    blendMode (blending): ${renderer.blending}`);
        }
      }

      // CompositionComponent
      if (c.dataType === 'CompositionComponent') {
        const compItems = c.items as Array<{ id: string }> | undefined;

        console.log(`    compositionComponent items: ${compItems?.length ?? 0}`);
        console.log(`    timelineAsset: ${JSON.stringify(c.timelineAsset)}`);
        console.log(`    sceneBindings: ${JSON.stringify(c.sceneBindings)}`);
      }

      console.log(`    all keys: ${Object.keys(c).join(', ')}`);
    }

    // --- Images ---
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                      IMAGES                            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`Total images: ${scene.images?.length ?? 0}`);
    if (scene.images) {
      for (const img of scene.images) {
        const i = img as unknown as Record<string, unknown>;

        console.log(`  [Image] id=${i.id} url=${typeof i.url === 'string' ? i.url.substring(0, 100) : i.url}`);
      }
    }

    // --- Textures ---
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                     TEXTURES                           ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`Total textures: ${scene.textures?.length ?? 0}`);
    if (scene.textures) {
      for (const tex of scene.textures) {
        console.log(`  [Texture] ${JSON.stringify(tex)}`);
      }
    }

    // --- Issues ---
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                      ISSUES                            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`Total issues: ${issues.length}`);
    for (const issue of issues) {
      console.log(`  [${issue.type}] ${issue.message}`);
    }

    // --- Debug Map ---
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                    DEBUG MAP                            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    const entries = Object.entries(debugMap);

    console.log(`Total debug map entries: ${entries.length}`);
    for (const [key, entry] of entries) {
      console.log(
        `  [${key}] figmaNode="${entry.figmaNodeName}" (${entry.figmaNodeId}), itemId=${entry.itemId}, components=${entry.componentIds.join(',')}, skipped=${entry.skipped ?? false}${entry.reason ? `, reason="${entry.reason}"` : ''}`,
      );
    }

    // Basic assertions so the test is valid
    expect(scene.items.length).toBeGreaterThan(0);
    expect(scene.components.length).toBeGreaterThan(0);
    expect(irNodes.length).toBeGreaterThan(0);
  });

  it('dumps raw kiwi data for VECTOR (type=6) nodes', () => {
    const figRaw = readFileSync(resolve(__dirname, './fixtures/baseline-custom.fig'));
    const figBytes = new Uint8Array(figRaw.buffer, figRaw.byteOffset, figRaw.byteLength);

    const { message } = decodeFigFile(figBytes);

    // Access nodeChanges the same way extractKiwiIR does
    const rec = message;
    const messageRec =
      rec.message !== null && typeof rec.message === 'object' ? (rec.message as Record<string, unknown>) : undefined;
    const container = messageRec ?? rec;
    const rawNodeChanges = container.nodeChanges;
    const nodeChanges = Array.isArray(rawNodeChanges) ? rawNodeChanges : [];

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║          RAW KIWI DATA FOR VECTOR NODES (type=6)       ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`Total nodeChanges: ${nodeChanges.length}`);

    // First: discover all type values and node names
    console.log('\n  ALL NODE TYPES IN FILE:');
    for (const raw of nodeChanges) {
      if (raw === null || typeof raw !== 'object') {
        continue;
      }
      const nc = raw as Record<string, unknown>;

      console.log(`    type=${JSON.stringify(nc.type)} (typeof=${typeof nc.type}) name="${nc.name}"`);
    }

    // Candidate keys that may contain vector/path data
    const PATH_KEYS = new Set([
      'vectorData',
      'vectorNetwork',
      'vectorNetworkBlob',
      'fillGeometry',
      'strokeGeometry',
      'segments',
      'vertices',
      'regions',
      'derivedLines',
      'handleMirroring',
      'vectorMirroring',
      'pathData',
      'pathGeometry',
      'paths',
      'geometryData',
      'geometry',
      'flattenedPathData',
      'fillPath',
      'strokePath',
      'individualStrokeWeights',
      'booleanOperation',
    ]);

    function describeValue(value: unknown, depth: number, maxDepth: number): string {
      if (value === null || value === undefined) {
        return String(value);
      }
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        const s = JSON.stringify(value);

        return s.length > 200 ? s.substring(0, 200) + '...' : s;
      }
      if (value instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value))) {
        return `Uint8Array(length=${(value as Uint8Array).length}) first32=[${Array.from((value as Uint8Array).slice(0, 32)).join(',')}]`;
      }
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return '[] (empty array)';
        }
        if (depth >= maxDepth) {
          return `Array(length=${value.length})`;
        }
        const items = value.slice(0, 5).map((v, i) => `  [${i}]: ${describeValue(v, depth + 1, maxDepth)}`);
        const suffix = value.length > 5 ? `\n  ... and ${value.length - 5} more items` : '';

        return `Array(length=${value.length}):\n${items.join('\n')}${suffix}`;
      }
      if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj);

        if (keys.length === 0) {
          return '{} (empty object)';
        }

        // Check if it's a numeric-keyed blob-like object
        if (keys.length > 8 && keys.every(k => /^\d+$/.test(k))) {
          return `NumericKeyedObject(length=${keys.length}) — likely byte array`;
        }
        if (depth >= maxDepth) {
          return `Object(keys=[${keys.join(', ')}])`;
        }
        const entries = keys.slice(0, 20).map(k => `  ${k}: ${describeValue(obj[k], depth + 1, maxDepth)}`);
        const suffix = keys.length > 20 ? `\n  ... and ${keys.length - 20} more keys` : '';

        return `Object(keys=${keys.length}):\n${entries.join('\n')}${suffix}`;
      }

      return `typeof=${typeof value}`;
    }

    let vectorCount = 0;

    for (const raw of nodeChanges) {
      if (raw === null || typeof raw !== 'object') {
        continue;
      }
      const nc = raw as Record<string, unknown>;

      if (
        nc.type !== 6 &&
        nc.type !== 'VECTOR' &&
        nc.type !== '6' &&
        nc.type !== 7 &&
        nc.type !== 'STAR' &&
        nc.type !== 8 &&
        nc.type !== 'LINE' &&
        nc.type !== 9 &&
        nc.type !== 'ELLIPSE' &&
        nc.type !== 11 &&
        nc.type !== 'REGULAR_POLYGON'
      ) {
        continue;
      }
      vectorCount++;

      const guid = nc.guid as Record<string, unknown> | undefined;
      const id = guid ? `${guid.sessionID ?? '?'}:${guid.localID ?? '?'}` : '?';

      console.log(`\n${'═'.repeat(60)}`);
      console.log(`VECTOR NODE: name="${nc.name}" id=${id}`);
      console.log(`${'═'.repeat(60)}`);

      // List ALL keys on this nodeChange
      const allKeys = Object.keys(nc).sort();

      console.log(`\n  ALL KEYS (${allKeys.length}):`);
      for (const key of allKeys) {
        const val = nc[key];
        const typeStr =
          val === null
            ? 'null'
            : val === undefined
              ? 'undefined'
              : Array.isArray(val)
                ? `array(${val.length})`
                : val instanceof Uint8Array
                  ? `Uint8Array(${val.length})`
                  : typeof val === 'object'
                    ? `object(keys=${Object.keys(val).length})`
                    : typeof val;
        const isPathKey = PATH_KEYS.has(key);

        console.log(`    ${isPathKey ? '>>> ' : '    '}${key}: ${typeStr}`);
      }

      // Now dump path-related keys in full detail
      console.log(`\n  PATH/VECTOR RELATED FIELDS (detailed):`);
      for (const key of allKeys) {
        if (!PATH_KEYS.has(key)) {
          continue;
        }
        const val = nc[key];

        console.log(`\n  ┌─ ${key} ─────────────────────────────`);
        console.log(`  │ ${describeValue(val, 0, 4).split('\n').join('\n  │ ')}`);
        console.log('  └───────────────────────────────────────');
      }

      // Also dump any key containing "vector", "path", "geom", "segment", "vert", "fill", "stroke" (case-insensitive)
      // that wasn't already in PATH_KEYS
      const extraPatterns =
        /vector|path|geom|segment|vert|fill|stroke|mirror|line|curve|point|handle|derived|flatten|boolean|wind|region/i;

      console.log(`\n  EXTRA KEYS MATCHING VECTOR PATTERNS:`);
      let foundExtra = false;

      for (const key of allKeys) {
        if (PATH_KEYS.has(key)) {
          continue;
        }
        if (!extraPatterns.test(key)) {
          continue;
        }
        foundExtra = true;
        const val = nc[key];

        console.log(`\n  ┌─ ${key} ─────────────────────────────`);
        console.log(`  │ ${describeValue(val, 0, 4).split('\n').join('\n  │ ')}`);
        console.log('  └───────────────────────────────────────');
      }
      if (!foundExtra) {
        console.log('    (none found)');
      }

      // Dump the FULL nodeChange as JSON (truncated to prevent excessive output)
      console.log(`\n  FULL JSON DUMP (truncated):`);
      try {
        const json = JSON.stringify(
          nc,
          (_, v) => {
            if (v instanceof Uint8Array) {
              return `[Uint8Array len=${v.length}]`;
            }

            return v;
          },
          2,
        );

        if (json.length > 8000) {
          console.log(json.substring(0, 8000));
          console.log(`... TRUNCATED (total ${json.length} chars)`);
        } else {
          console.log(json);
        }
      } catch {
        console.log('  (could not serialize to JSON)');
      }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`TOTAL VECTOR NODES FOUND: ${vectorCount}`);
    console.log(`${'═'.repeat(60)}`);

    // Now dump the blobs referenced by VECTOR nodes
    const rawBlobs = Array.isArray(container.blobs) ? container.blobs : [];

    console.log(`\nTotal blobs in file: ${rawBlobs.length}`);

    // Collect all blob indices referenced by vector nodes
    const blobIndices = new Set<number>();

    for (const raw of nodeChanges) {
      if (raw === null || typeof raw !== 'object') {
        continue;
      }
      const nc = raw as Record<string, unknown>;

      if (
        nc.type !== 'VECTOR' &&
        nc.type !== 6 &&
        nc.type !== 'STAR' &&
        nc.type !== 7 &&
        nc.type !== 'ELLIPSE' &&
        nc.type !== 9 &&
        nc.type !== 'REGULAR_POLYGON' &&
        nc.type !== 11
      ) {
        continue;
      }

      // vectorData.vectorNetworkBlob
      const vd = nc.vectorData as Record<string, unknown> | undefined;

      if (vd && typeof vd.vectorNetworkBlob === 'number') {
        blobIndices.add(vd.vectorNetworkBlob);
      }

      // fillGeometry[*].commandsBlob
      const fg = nc.fillGeometry as Array<Record<string, unknown>> | undefined;

      if (Array.isArray(fg)) {
        for (const g of fg) {
          if (g && typeof g.commandsBlob === 'number') {
            blobIndices.add(g.commandsBlob);
          }
        }
      }

      // strokeGeometry[*].commandsBlob
      const sg = nc.strokeGeometry as Array<Record<string, unknown>> | undefined;

      if (Array.isArray(sg)) {
        for (const g of sg) {
          if (g && typeof g.commandsBlob === 'number') {
            blobIndices.add(g.commandsBlob);
          }
        }
      }
    }

    console.log(
      `\nBlob indices referenced by vector-like nodes: [${[...blobIndices].sort((a, b) => a - b).join(', ')}]`,
    );

    for (const idx of [...blobIndices].sort((a, b) => a - b)) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`BLOB #${idx}:`);
      if (idx >= rawBlobs.length) {
        console.log('  OUT OF RANGE');
        continue;
      }
      const blob = rawBlobs[idx];

      if (blob === null || blob === undefined) {
        console.log('  null/undefined');
        continue;
      }

      // Convert blob to Uint8Array
      let bytes: Uint8Array;

      if (blob instanceof Uint8Array) {
        bytes = blob;
      } else if (typeof blob === 'object' && 'bytes' in (blob as Record<string, unknown>)) {
        const inner = (blob as Record<string, unknown>).bytes;

        if (inner instanceof Uint8Array) {
          bytes = inner;
        } else {
          console.log(
            `  blob.bytes type: ${typeof inner}, keys: ${inner && typeof inner === 'object' ? Object.keys(inner).length : 'N/A'}`,
          );
          bytes = new Uint8Array(0);
        }
      } else {
        console.log(`  blob type: ${typeof blob}, constructor: ${(blob as object)?.constructor?.name}`);
        bytes = new Uint8Array(0);
      }

      console.log(`  length: ${bytes.length} bytes`);
      if (bytes.length > 0) {
        // Show first 200 bytes as hex
        const hexChunks: string[] = [];

        for (let i = 0; i < Math.min(bytes.length, 200); i++) {
          hexChunks.push(bytes[i].toString(16).padStart(2, '0'));
        }
        console.log(`  hex (first ${Math.min(bytes.length, 200)} bytes): ${hexChunks.join(' ')}`);

        // Also try to interpret as float32 array (common for coordinates)
        if (bytes.length >= 8) {
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const floatCount = Math.min(Math.floor(bytes.length / 4), 30);
          const floats: string[] = [];

          for (let i = 0; i < floatCount; i++) {
            try {
              floats.push(view.getFloat32(i * 4, true).toFixed(4));
            } catch {
              floats.push('ERR');
            }
          }
          console.log(`  as float32LE (first ${floatCount}): [${floats.join(', ')}]`);
        }
      }
    }

    // Pass even if no VECTOR nodes found — the purpose is diagnostic
    expect(nodeChanges.length).toBeGreaterThan(0);
  });

  it('parses fillGeometry/strokeGeometry commandsBlob byte-by-byte', () => {
    const figRaw = readFileSync(resolve(__dirname, './fixtures/baseline-custom.fig'));
    const figBytes = new Uint8Array(figRaw.buffer, figRaw.byteOffset, figRaw.byteLength);

    const { message } = decodeFigFile(figBytes);

    const rec = message;
    const messageRec =
      rec.message !== null && typeof rec.message === 'object' ? (rec.message as Record<string, unknown>) : undefined;
    const container = messageRec ?? rec;
    const rawNodeChanges = container.nodeChanges;
    const nodeChanges = Array.isArray(rawNodeChanges) ? rawNodeChanges : [];
    const rawBlobs = Array.isArray(container.blobs) ? container.blobs : [];

    /** Convert blob entry to Uint8Array */
    function toBytes(blob: unknown): Uint8Array {
      if (blob instanceof Uint8Array) {
        return blob;
      }
      if (blob !== null && typeof blob === 'object' && ArrayBuffer.isView(blob)) {
        return new Uint8Array(
          (blob as Uint8Array).buffer,
          (blob as Uint8Array).byteOffset,
          (blob as Uint8Array).byteLength,
        );
      }
      if (blob !== null && typeof blob === 'object') {
        const obj = blob as Record<string, unknown>;

        if ('bytes' in obj) {
          return toBytes(obj.bytes);
        }
        const keys = Object.keys(obj);

        if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
          const arr = new Uint8Array(keys.length);

          for (const k of keys) {
            arr[Number(k)] = Number(obj[k]) & 0xff;
          }

          return arr;
        }
      }

      return new Uint8Array(0);
    }

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   commandsBlob BINARY PARSER — fillGeometry/stroke     ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    // Collect VECTOR-like nodes
    const vectorTypes = new Set([6, 'VECTOR', 7, 'STAR', 9, 'ELLIPSE', 11, 'REGULAR_POLYGON']);

    for (const raw of nodeChanges) {
      if (raw === null || typeof raw !== 'object') {
        continue;
      }
      const nc = raw as Record<string, unknown>;

      if (!vectorTypes.has(nc.type as string | number)) {
        continue;
      }

      const guid = nc.guid as Record<string, unknown> | undefined;
      const id = guid ? `${guid.sessionID ?? '?'}:${guid.localID ?? '?'}` : '?';
      const name = (nc.name as string) ?? '?';

      console.log(`\n${'═'.repeat(70)}`);
      console.log(`NODE: name="${name}" id=${id} type=${nc.type}`);
      console.log(`${'═'.repeat(70)}`);

      // Process fillGeometry and strokeGeometry
      for (const geoKey of ['fillGeometry', 'strokeGeometry'] as const) {
        const geoArr = nc[geoKey] as Array<Record<string, unknown>> | undefined;

        if (!Array.isArray(geoArr) || geoArr.length === 0) {
          console.log(`\n  ${geoKey}: (none)`);
          continue;
        }

        for (let gi = 0; gi < geoArr.length; gi++) {
          const geo = geoArr[gi];

          if (!geo || typeof geo !== 'object') {
            continue;
          }

          const blobIdx = geo.commandsBlob as number | undefined;
          const windingRule = geo.windingRule;
          const styleIdxOverride = geo.styleIndexOverride;

          console.log(
            `\n  ${geoKey}[${gi}]: commandsBlob=${blobIdx} windingRule=${windingRule} styleIdxOverride=${styleIdxOverride}`,
          );
          console.log(`    all keys: ${Object.keys(geo).join(', ')}`);

          if (blobIdx === undefined || blobIdx === null) {
            console.log('    (no commandsBlob index)');
            continue;
          }
          if (blobIdx >= rawBlobs.length) {
            console.log(`    ERROR: blobIdx ${blobIdx} >= rawBlobs.length ${rawBlobs.length}`);
            continue;
          }

          const bytes = toBytes(rawBlobs[blobIdx]);

          console.log(`    blob length: ${bytes.length} bytes`);

          if (bytes.length === 0) {
            console.log('    (empty blob)');
            continue;
          }

          // Dump full hex
          const hexAll: string[] = [];

          for (let i = 0; i < bytes.length; i++) {
            hexAll.push(bytes[i].toString(16).padStart(2, '0'));
          }
          console.log(`    hex: ${hexAll.join(' ')}`);

          // Try multiple parsing strategies
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

          // ─── Strategy 1: Command byte + float32LE coords ───
          // Hypothesis: 0=Close, 1=MoveTo(2 floats), 2=LineTo(2 floats), 3=CubicBezier(6 floats)
          console.log('\n    ─── STRATEGY 1: cmd_byte + float32LE (0=Z, 1=M, 2=L, 3=C) ───');
          {
            let offset = 0;
            let cmdNum = 0;

            while (offset < bytes.length) {
              const cmd = bytes[offset];

              offset++;
              cmdNum++;

              if (cmd === 0) {
                console.log(`      [${cmdNum}] cmd=0x00 (ClosePath/Z) @ byte ${offset - 1}`);
              } else if (cmd === 1) {
                if (offset + 8 <= bytes.length) {
                  const x = view.getFloat32(offset, true);
                  const y = view.getFloat32(offset + 4, true);

                  console.log(
                    `      [${cmdNum}] cmd=0x01 (MoveTo/M) @ byte ${offset - 1} → x=${x.toFixed(4)}, y=${y.toFixed(4)}`,
                  );
                  offset += 8;
                } else {
                  console.log(
                    `      [${cmdNum}] cmd=0x01 (MoveTo/M) @ byte ${offset - 1} → INSUFFICIENT DATA (need 8 bytes, have ${bytes.length - offset})`,
                  );

                  break;
                }
              } else if (cmd === 2) {
                if (offset + 8 <= bytes.length) {
                  const x = view.getFloat32(offset, true);
                  const y = view.getFloat32(offset + 4, true);

                  console.log(
                    `      [${cmdNum}] cmd=0x02 (LineTo/L) @ byte ${offset - 1} → x=${x.toFixed(4)}, y=${y.toFixed(4)}`,
                  );
                  offset += 8;
                } else {
                  console.log(
                    `      [${cmdNum}] cmd=0x02 (LineTo/L) @ byte ${offset - 1} → INSUFFICIENT DATA (need 8 bytes, have ${bytes.length - offset})`,
                  );

                  break;
                }
              } else if (cmd === 3) {
                if (offset + 24 <= bytes.length) {
                  const cp1x = view.getFloat32(offset, true);
                  const cp1y = view.getFloat32(offset + 4, true);
                  const cp2x = view.getFloat32(offset + 8, true);
                  const cp2y = view.getFloat32(offset + 12, true);
                  const x = view.getFloat32(offset + 16, true);
                  const y = view.getFloat32(offset + 20, true);

                  console.log(
                    `      [${cmdNum}] cmd=0x03 (CubicBezier/C) @ byte ${offset - 1} → cp1=(${cp1x.toFixed(4)},${cp1y.toFixed(4)}) cp2=(${cp2x.toFixed(4)},${cp2y.toFixed(4)}) end=(${x.toFixed(4)},${y.toFixed(4)})`,
                  );
                  offset += 24;
                } else {
                  console.log(
                    `      [${cmdNum}] cmd=0x03 (CubicBezier/C) @ byte ${offset - 1} → INSUFFICIENT DATA (need 24 bytes, have ${bytes.length - offset})`,
                  );

                  break;
                }
              } else if (cmd === 4) {
                // Possible quadratic bezier? (4 floats: cp1x, cp1y, x, y)
                if (offset + 16 <= bytes.length) {
                  const cpx = view.getFloat32(offset, true);
                  const cpy = view.getFloat32(offset + 4, true);
                  const x = view.getFloat32(offset + 8, true);
                  const y = view.getFloat32(offset + 12, true);

                  console.log(
                    `      [${cmdNum}] cmd=0x04 (QuadBezier?/Q) @ byte ${offset - 1} → cp=(${cpx.toFixed(4)},${cpy.toFixed(4)}) end=(${x.toFixed(4)},${y.toFixed(4)})`,
                  );
                  offset += 16;
                } else {
                  console.log(`      [${cmdNum}] cmd=0x04 @ byte ${offset - 1} → INSUFFICIENT DATA`);

                  break;
                }
              } else {
                console.log(
                  `      [${cmdNum}] cmd=0x${cmd.toString(16).padStart(2, '0')} (UNKNOWN) @ byte ${offset - 1}`,
                );
                // Try to show next few bytes for context
                const remaining = Math.min(16, bytes.length - offset);
                const context: string[] = [];

                for (let i = 0; i < remaining; i++) {
                  context.push(bytes[offset + i].toString(16).padStart(2, '0'));
                }
                console.log(`        next ${remaining} bytes: ${context.join(' ')}`);

                break;
              }
            }
            if (offset === bytes.length) {
              console.log(`      ✓ Consumed all ${bytes.length} bytes perfectly`);
            } else if (offset < bytes.length) {
              console.log(`      ✗ ${bytes.length - offset} bytes remaining unconsumed`);
            }
          }

          // ─── Strategy 2: All float32LE (no command bytes) ───
          console.log('\n    ─── STRATEGY 2: Pure float32LE array ───');
          {
            const floatCount = Math.floor(bytes.length / 4);
            const remainder = bytes.length % 4;
            const floats: number[] = [];

            for (let i = 0; i < floatCount; i++) {
              floats.push(view.getFloat32(i * 4, true));
            }
            console.log(
              `      ${floatCount} floats (remainder ${remainder} bytes): [${floats.map(f => f.toFixed(4)).join(', ')}]`,
            );
          }

          // ─── Strategy 3: Command byte then 2 floats each (all cmds = 2 coords) ───
          console.log('\n    ─── STRATEGY 3: cmd_byte + always 2 float32LE ───');
          {
            let offset = 0;
            let cmdNum = 0;

            while (offset < bytes.length) {
              const cmd = bytes[offset];

              offset++;
              cmdNum++;

              if (offset + 8 <= bytes.length) {
                const x = view.getFloat32(offset, true);
                const y = view.getFloat32(offset + 4, true);

                console.log(
                  `      [${cmdNum}] cmd=0x${cmd.toString(16).padStart(2, '0')} @ byte ${offset - 1} → (${x.toFixed(4)}, ${y.toFixed(4)})`,
                );
                offset += 8;
              } else if (cmd === 0 && offset === bytes.length) {
                console.log(`      [${cmdNum}] cmd=0x00 (ClosePath) @ byte ${offset - 1} — final byte`);
              } else {
                console.log(
                  `      [${cmdNum}] cmd=0x${cmd.toString(16).padStart(2, '0')} @ byte ${offset - 1} → insufficient data`,
                );

                break;
              }
            }
            if (offset === bytes.length) {
              console.log(`      ✓ Consumed all ${bytes.length} bytes perfectly`);
            } else {
              console.log(`      ✗ ${bytes.length - offset} bytes remaining`);
            }
          }
        }
      }
    }

    expect(nodeChanges.length).toBeGreaterThan(0);
  });
});

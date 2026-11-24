/**
 * Figma Clipboard Orchestrator
 *
 * Composes scene data into Figma clipboard HTML format.
 * Delegates to focused modules for each concern:
 *
 * - kiwi-archive:     fig-kiwi archive format and clipboard HTML
 * - convert-node:     core SceneNode → FigmaNodeChange conversion
 * - layout-resolver:  auto layout inference from geometry
 * - grid-handler:     CSS Grid → Figma grid structures
 * - text runtime:     optional font resolution, character widths, and glyph paths
 * - paint-helpers:    color parsing, paint creation, image handling
 */

import { enrichSceneForBaseline } from './baseline-normalizers';
import { ClipboardBlobStore } from './clipboard-blob-store';
import type { ClipboardBlobStats } from './clipboard-blob-store';
import {
  compileSchema,
  encodeBinarySchema,
  pako,
  writeArchive,
  composeClipboardHTML,
} from './kiwi-archive';
import {
  makeGUID,
  resetLocalIdCounter,
  convertNode,
  sortRootChildren,
  maybeSwapOverlayIconBlobIndex,
} from './convert-node';
import { resetGridTrackIdCounter, positionForIndex } from './grid-handler';
import { resolveAutoLayout } from './layout-resolver';
import { makeSolidPaint } from './paint-helpers';
import { BASIC_TEXT_CONVERSION_RUNTIME } from './text-conversion-runtime';
import type { TextConversionRuntime } from './text-conversion-runtime';
import type { SceneResult, FigmaGUID, FigmaNodeChange } from '../types';

// ---- Public API re-exports ----
export { parseColor } from './paint-helpers';

// ---- Main: sceneData → Figma clipboard HTML ----

/** Figma clipboard payload and the binary resources produced during conversion. */
export interface FigmaClipboardResult {
  /** Figma clipboard HTML to copy with the `text/html` MIME type. */
  html: string;
  /** Deduplication statistics for embedded glyph, image, and vector blobs. */
  blobStats: ClipboardBlobStats;
  /** Archive with external image references, used when packaging a `.fig` file. */
  archiveData: Uint8Array;
  /** Self-contained clipboard archive with embedded image blobs. */
  currentClipboardArchiveData: Uint8Array;
  /** External image files referenced by `archiveData`. */
  imageEntries: FigmaArchiveImageEntry[];
}

/** An external image stored alongside `canvas.fig` in a `.fig` archive. */
export interface FigmaArchiveImageEntry {
  /** Archive entry path in the form `images/<sha1>`. */
  name: string;
  /** Encoded image bytes. */
  data: Uint8Array;
}

export interface FigmaClipboardCoreOptions {
  layoutMode?: 'snapshot' | 'auto-layout';
  textRuntime?: TextConversionRuntime;
}

export function createFigmaClipboardWithSchema(
  scenes: SceneResult[],
  schema: Parameters<typeof compileSchema>[0],
  options: FigmaClipboardCoreOptions = {},
): FigmaClipboardResult {
  const compiled = compileSchema(schema);

  resetLocalIdCounter(100);
  resetGridTrackIdCounter();
  const textRuntime = options.textRuntime ?? BASIC_TEXT_CONVERSION_RUNTIME;
  const sessionID = 0;
  const nodeChanges: FigmaNodeChange[] = [];
  const blobStore = new ClipboardBlobStore();
  const blobs = blobStore.blobs;

  const docGUID: FigmaGUID = { sessionID: 0, localID: 0 };

  nodeChanges.push({
    guid: docGUID,
    phase: 'CREATED',
    type: 'DOCUMENT',
    name: 'Document',
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    strokeWeight: 0,
    strokeAlign: 'CENTER',
    strokeJoin: 'BEVEL',
  });

  const canvasGUID = makeGUID(sessionID);

  nodeChanges.push({
    guid: canvasGUID,
    phase: 'CREATED',
    parentIndex: { guid: docGUID, position: '!' },
    type: 'CANVAS',
    name: 'Page 1',
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    backgroundOpacity: 1,
    backgroundEnabled: false,
    backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeWeight: 0,
    strokeAlign: 'CENTER',
    strokeJoin: 'BEVEL',
  });

  const validScenes = scenes.filter(sc => !sc.error && sc.sceneData);

  for (let i = 0; i < validScenes.length; i++) {
    const scene = validScenes[i];
    const sd = enrichSceneForBaseline(scene.sceneData!, options.layoutMode);

    const frameGUID = makeGUID(sessionID);
    const rootNC: FigmaNodeChange = {
      guid: frameGUID,
      phase: 'CREATED',
      parentIndex: { guid: canvasGUID, position: positionForIndex(i) },
      type: 'FRAME',
      name: sd.name || scene.name || 'Imported Design',
      visible: true,
      opacity: 1,
      size: { x: sd.width || 375, y: sd.height || 812 },
      transform: {
        m00: 1,
        m01: 0,
        m02: i * ((sd.width || 375) + 100),
        m10: 0,
        m11: 1,
        m12: 0,
      },
      dashPattern: [],
      strokeWeight: 1,
      strokeAlign: 'INSIDE',
      strokeJoin: 'MITER',
      effects: [],
      horizontalConstraint: 'STRETCH',
      verticalConstraint: 'MIN',
      frameMaskDisabled: true,
      stackMode: options.layoutMode === 'snapshot' ? 'NONE' : 'VERTICAL',
      stackSpacing: 0,
      stackHorizontalPadding: 0,
      stackVerticalPadding: 0,
      stackPaddingRight: 0,
      stackPaddingBottom: 0,
      stackPrimaryAlignItems: 'MIN',
      stackCounterAlignItems: 'MIN',
      stackChildAlignSelf: 'AUTO',
      stackPositioning: 'AUTO',
      stackReverseZIndex: false,
      stackCounterSizing: 'FIXED',
      minSize: { value: { x: 0, y: Math.round(sd.height || 812) } },
    };

    const sdIR = sd.ir;
    const rootFills = sdIR?.fills;

    if (rootFills && rootFills.length > 0) {
      rootNC.fillPaints = rootFills.filter(f => f.type === 'SOLID').map(f => makeSolidPaint(f.color));
    }

    const rootAutoLayout = options.layoutMode === 'snapshot' ? null : resolveAutoLayout(sd);

    if (rootAutoLayout) {
      Object.assign(rootNC, rootAutoLayout);
    }
    // Always apply clipsContent from IR (not just when autoLayout exists)
    rootNC.frameMaskDisabled = !(sdIR?.clipsContent ?? false);

    nodeChanges.push(rootNC);

    const rootAbsX = sd.x || 0;
    const rootAbsY = sd.y || 0;

    if (sd.children) {
      // Pass root auto-layout to non-absolute children for correct constraints.
      // Absolute children (position:fixed/absolute) handle their own constraints
      // and should not be affected by the parent auto-layout.
      const rootLayout = rootAutoLayout || null;
      const orderedChildren = sortRootChildren(sd.children);

      for (let j = 0; j < orderedChildren.length; j++) {
        const child = orderedChildren[j];
        const childIsAbsolute = !!child.ir?.isAbsolute;
        const childLayout = childIsAbsolute ? null : rootLayout;

        convertNode(
          child,
          frameGUID,
          positionForIndex(j),
          nodeChanges,
          sessionID,
          blobStore,
          rootAbsX,
          rootAbsY,
          childLayout,
          sd.width || 0,
          sd.height || 0,
          undefined,
          undefined,
          textRuntime,
          options.layoutMode,
        );
      }
    }
  }

  const internalCanvasGUID = makeGUID(sessionID);

  nodeChanges.push({
    guid: internalCanvasGUID,
    phase: 'CREATED',
    parentIndex: { guid: docGUID, position: '~' },
    type: 'CANVAS',
    name: 'Internal Only Canvas',
    visible: false,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    backgroundOpacity: 1,
    backgroundEnabled: true,
    internalOnly: true,
  });

  maybeSwapOverlayIconBlobIndex(nodeChanges, blobs);

  const pasteID = Math.floor(Math.random() * 2147483647);
  const message = {
    type: 'NODE_CHANGES',
    sessionID: 0,
    ackID: 0,
    nodeChanges,
    blobs,
    pasteID,
    pasteFileKey: '0',
    pasteIsPartiallyOutsideEnclosingFrame: false,
    pastePageId: { sessionID: 0, localID: 1 },
    isCut: false,
    pasteEditorType: 'DESIGN',
    publishedAssetGuids: [],
  };

  const binSchema = encodeBinarySchema(schema);
  const encodedMessage = compiled.encodeMessage(message);
  const clipboardArchiveData = writeArchive([pako.deflateRaw(binSchema), pako.deflateRaw(encodedMessage)]);
  const currentClipboardNodeChanges = structuredClone(nodeChanges);

  migrateTextDataForFigmaFile(currentClipboardNodeChanges);
  const currentClipboardMessage = { ...message, nodeChanges: currentClipboardNodeChanges };
  const currentClipboardEncodedMessage = compiled.encodeMessage(currentClipboardMessage);
  const currentClipboardArchiveData = writeArchive([
    pako.deflateRaw(binSchema),
    pako.deflateRaw(currentClipboardEncodedMessage),
  ]);
  const fileNodeChanges = structuredClone(currentClipboardNodeChanges);
  const { blobs: fileBlobs, imageEntries } = externalizeImages(fileNodeChanges, blobs);
  const fileMessage = {
    type: 'NODE_CHANGES',
    sessionID: 0,
    ackID: 0,
    nodeChanges: fileNodeChanges,
    blobs: fileBlobs,
  };
  const fileEncodedMessage = compiled.encodeMessage(fileMessage);
  const archiveData = writeArchive([pako.deflateRaw(binSchema), pako.deflateRaw(fileEncodedMessage)]);

  const meta = {
    fileKey: '0',
    pasteID: message.pasteID,
    dataType: 'scene',
  };

  return {
    html: composeClipboardHTML(meta, clipboardArchiveData),
    blobStats: blobStore.getStats(),
    archiveData,
    currentClipboardArchiveData,
    imageEntries,
  };
}

function migrateTextDataForFigmaFile(nodeChanges: FigmaNodeChange[]): void {
  for (const nodeChange of nodeChanges) {
    const textData = nodeChange.textData;

    if (nodeChange.type !== 'TEXT' || textData === undefined) {
      continue;
    }

    const {
      characters,
      lines,
      layoutSize,
      baselines,
      glyphs,
      decorations,
      fontMetaData,
      truncationStartIndex,
      truncatedHeight,
      logicalIndexToCharacterOffsetMap,
    } = textData;

    nodeChange.textData = {
      characters,
      lines: lines?.map(line => ({
        ...line,
        styleId: 0,
        listStartOffset: 0,
        isFirstLineOfList: false,
      })),
    };
    nodeChange.derivedTextData = {
      layoutSize,
      baselines,
      glyphs: glyphs?.map(glyph => ({ ...glyph, rotation: 0 })),
      decorations,
      fontMetaData,
      truncationStartIndex,
      truncatedHeight,
      logicalIndexToCharacterOffsetMap,
      derivedLines: [{ directionality: 'LTR' }],
    };
    nodeChange.emojiImageSet = 'APPLE';
  }
}

function externalizeImages(
  nodeChanges: FigmaNodeChange[],
  blobs: Array<{ bytes: number[] }>,
): { blobs: Array<{ bytes: number[] }>; imageEntries: FigmaArchiveImageEntry[] } {
  const images = new Map<string, Uint8Array>();
  const imageBlobIndexes = new Set<number>();
  const retainedBlobIndexes = new Set<number>();

  for (const nodeChange of nodeChanges) {
    for (const paints of [nodeChange.fillPaints, nodeChange.strokePaints]) {
      if (paints === undefined) {
        continue;
      }

      for (const paint of paints) {
        const image = paint.image;
        const dataBlob = image?.dataBlob;

        if (
          image !== undefined && Array.isArray(image.hash) && image.hash.length > 0 &&
          image.hash.every(isByte) && typeof dataBlob === 'number' && Number.isInteger(dataBlob) && dataBlob >= 0
        ) {
          const blob = blobs[dataBlob];

          if (blob !== undefined) {
            const hashHex = image.hash.map(byte => byte.toString(16).padStart(2, '0')).join('');

            images.set(`images/${hashHex}`, Uint8Array.from(blob.bytes));
            imageBlobIndexes.add(dataBlob);
          }
        }
      }
    }

    const vectorBlob = nodeChange.vectorData?.vectorNetworkBlob;

    if (typeof vectorBlob === 'number') {
      retainedBlobIndexes.add(vectorBlob);
    }
    for (const textData of [nodeChange.textData, nodeChange.derivedTextData]) {
      for (const glyph of textData?.glyphs ?? []) {
        if (typeof glyph.commandsBlob === 'number') {
          retainedBlobIndexes.add(glyph.commandsBlob);
        }
      }
    }
  }

  const oldToNewIndex = new Map<number, number>();
  const fileBlobs: Array<{ bytes: number[] }> = [];

  for (let index = 0; index < blobs.length; index++) {
    if (imageBlobIndexes.has(index) && !retainedBlobIndexes.has(index)) {
      continue;
    }

    oldToNewIndex.set(index, fileBlobs.length);
    fileBlobs.push(blobs[index]);
  }

  for (const nodeChange of nodeChanges) {
    for (const paints of [nodeChange.fillPaints, nodeChange.strokePaints]) {
      for (const paint of paints ?? []) {
        if (paint.image !== undefined) {
          delete paint.image.dataBlob;
        }
      }
    }

    if (nodeChange.vectorData !== undefined) {
      nodeChange.vectorData.vectorNetworkBlob = remapBlobIndex(
        nodeChange.vectorData.vectorNetworkBlob,
        oldToNewIndex,
      );
    }
    for (const textData of [nodeChange.textData, nodeChange.derivedTextData]) {
      for (const glyph of textData?.glyphs ?? []) {
        if (glyph.commandsBlob !== undefined) {
          glyph.commandsBlob = remapBlobIndex(glyph.commandsBlob, oldToNewIndex);
        }
      }
    }
  }

  return {
    blobs: fileBlobs,
    imageEntries: Array.from(images, ([name, data]) => ({ name, data })),
  };
}

function remapBlobIndex(index: number, indexes: Map<number, number>): number {
  const mapped = indexes.get(index);

  if (mapped === undefined) {
    throw new Error(`Missing retained Figma blob index ${index}.`);
  }

  return mapped;
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

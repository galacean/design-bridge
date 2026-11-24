import { shapeFontLigatures } from './shape-font-ligatures';
import * as fontkit from 'fontkit';
import {
  DEFAULT_FONT_FALLBACK_FAMILIES,
  mapFontStyle,
  normalizeFontFamily,
  resolveFigmaFontFamily,
} from './font-mapping';
import { encodeGlyphCommandsBlob } from './glyph-path-encoding';
import { normalizeFontBytes } from './normalize-font-bytes';
import type { TextConversionRuntime } from './text-conversion-runtime';
import type { SceneNode, SceneResult } from '../types';

/** Caller-supplied font bytes for browser clipboard and `.fig` generation. */
export interface BrowserFontData {
  /** CSS font family name used to match extracted text. */
  family: string;
  /** Font face style, such as `Regular` or `Bold Italic`; inferred from weight when omitted. */
  style?: string;
  /** CSS numeric weight used for style inference. Defaults to 400. */
  weight?: number;
  /** Font data in a supported format, such as TTF, OTF, WOFF, or WOFF2. */
  bytes: ArrayBuffer | Uint8Array;
}

/** Local Font Access policy: `auto` tolerates unavailable or denied access; `required` rejects it. */
export type BrowserLocalFontAccess = 'auto' | 'disabled' | 'required';

/** Font sources used to prepare editable text and glyph outlines in the browser. */
export interface BrowserTextConversionOptions {
  /** Explicit font bytes, usable without Local Font Access or external font requests. */
  fonts?: BrowserFontData[];
  /** Defaults to `auto`. Local Font Access requires browser support, a secure context, and permission. */
  localFontAccess?: BrowserLocalFontAccess;
}

export interface BrowserTextRuntimePreparation {
  runtime: TextConversionRuntime;
  glyphCoverage: BrowserTextGlyphCoverage;
  fontLoadErrors: string[];
  loadedFontCount: number;
  missingFontFamilies: string[];
}

/** Glyph coverage and font resolution observations collected during browser export. */
export interface BrowserTextGlyphCoverage {
  /** Number of non-whitespace character glyph requests, including repeated characters. */
  requested: number;
  /** Number of non-whitespace character requests resolved to glyphs. */
  resolved: number;
  /** Distinct characters whose glyphs could not be encoded. */
  missingCharacters: string[];
  /** Requested and encoded families, with the characters assigned to each resolution. */
  fontResolutions: Array<{ requestedFamily: string; resolvedFamily: string; characters: string[] }>;
}

interface FontRequirement {
  aliases: Set<string>;
  family: string;
  style: string;
  text: string;
  weight: number;
  sources: string[];
}

interface BrowserLocalFontData {
  family: string;
  style: string;
  fullName: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}

type QueryLocalFonts = () => Promise<BrowserLocalFontData[]>;

const normalizeLookup = (value: unknown): string => String(value ?? '').trim().replace(/["']/g, '').toLowerCase();

export async function createBrowserTextConversionRuntime(
  scenes: SceneResult[],
  options: BrowserTextConversionOptions = {},
): Promise<BrowserTextRuntimePreparation> {
  const requirements = collectFontRequirements(scenes);
  const facesByFamily = new Map<string, fontkit.Font[]>();
  const facesBySource = new Map<string, fontkit.Font[]>();
  const fallbackFaces: fontkit.Font[] = [];
  const registeredFaces = new Set<fontkit.Font>();
  const fontLoadErrors: string[] = [];

  const registerFaces = async (
    bytes: ArrayBuffer | Uint8Array,
    aliases: Iterable<string>,
    source?: string,
    preferredStyle?: string,
  ): Promise<void> => {
    let parsed: fontkit.Font | fontkit.FontCollection;

    try {
      const data = await normalizeFontBytes(bytes);

      parsed = fontkit.create(data as unknown as Parameters<typeof fontkit.create>[0]);
    } catch (error) {
      fontLoadErrors.push(error instanceof Error ? error.message : String(error));

      return;
    }
    const faces = selectFaces(parsed, preferredStyle);

    for (const face of faces) {
      registeredFaces.add(face);
      registerFaceAlias(facesByFamily, face.familyName, face);
      for (const alias of aliases) {
        registerFaceAlias(facesByFamily, alias, face);
      }
      if (source !== undefined) {
        const sourceFaces = facesBySource.get(source) ?? [];

        if (!sourceFaces.includes(face)) {
          sourceFaces.push(face);
          facesBySource.set(source, sourceFaces);
        }
      }
    }
  };

  for (const font of options.fonts ?? []) {
    const normalizedFamily = normalizeFontFamily(font.family);
    const style = font.style ?? mapFontStyle(font.weight ?? 400, normalizedFamily);

    await registerFaces(font.bytes, [font.family, normalizedFamily], undefined, style);
  }

  const sourceCache = new Map<string, Promise<ArrayBuffer | null>>();

  for (const requirement of requirements) {
    for (const source of requirement.sources) {
      let request = sourceCache.get(source);

      if (request === undefined) {
        request = fetchFontBytes(source);
        sourceCache.set(source, request);
      }
      const bytes = await request;

      if (bytes !== null) {
        await registerFaces(bytes, requirement.aliases, source, requirement.style);
      }
    }
  }

  const localFontAccess = options.localFontAccess ?? 'auto';

  if (localFontAccess !== 'disabled') {
    const queryLocalFonts = getQueryLocalFonts();

    if (queryLocalFonts === null) {
      if (localFontAccess === 'required') {
        throw new Error('Browser local font access is unavailable.');
      }
    } else {
      try {
        const localFonts = await queryLocalFonts();
        const desiredFamilies = collectDesiredLocalFamilies(requirements);

        for (const family of desiredFamilies) {
          const matches = localFonts.filter(font => fontFamilyMatches(font.family, family));
          const preferred = matches.sort((left, right) =>
            styleDistance(left.style, family.style) - styleDistance(right.style, family.style),
          )[0];

          if (preferred === undefined) {
            continue;
          }
          const bytes = await preferred.blob().then(blob => blob.arrayBuffer());

          await registerFaces(bytes, family.aliases, undefined, family.style);
        }
      } catch (error) {
        if (localFontAccess === 'required') {
          const detail = error instanceof Error ? ` ${error.message}` : '';

          throw new Error(`Browser local font access was denied or failed.${detail}`, { cause: error });
        }
      }
    }
  }

  for (const family of DEFAULT_FONT_FALLBACK_FAMILIES) {
    for (const face of facesByFamily.get(normalizeLookup(family)) ?? []) {
      if (!fallbackFaces.includes(face)) {
        fallbackFaces.push(face);
      }
    }
  }

  const glyphCoverage: BrowserTextGlyphCoverage = { requested: 0, resolved: 0, missingCharacters: [], fontResolutions: [] };
  const runtime = createRuntime(facesByFamily, facesBySource, fallbackFaces, glyphCoverage);
  const missingFontFamilies = requirements
    .filter(requirement => !hasFaceForRequirement(requirement, facesByFamily, facesBySource))
    .map(requirement => requirement.family)
    .filter((family, index, list) => list.indexOf(family) === index);

  return {
    runtime,
    glyphCoverage,
    fontLoadErrors,
    loadedFontCount: registeredFaces.size,
    missingFontFamilies,
  };
}

function collectFontRequirements(scenes: SceneResult[]): FontRequirement[] {
  const requirements = new Map<string, FontRequirement>();

  const visit = (node: SceneNode): void => {
    if (node.type === 'text' && (node.text ?? '').trim() !== '') {
      const rawFamily = node.ir.textProps?.fontFamily ?? node.styles.fontFamily ?? 'Inter';
      const family = normalizeFontFamily(rawFamily);
      const weight = node.ir.textProps?.fontWeight ?? parseFontWeight(node.styles.fontWeight);
      const style = mapFontStyle(weight, family, node.ir.textProps?.fontStyle ?? node.styles.fontStyle);
      const sources = node.fontSources !== undefined && node.fontSources.length > 0
        ? node.fontSources
        : node.fontSource !== undefined && node.fontSource !== null && node.fontSource !== ''
          ? [node.fontSource]
          : [];
      const key = `${normalizeLookup(family)}::${normalizeLookup(style)}::${sources.join('|')}`;
      const requirement = requirements.get(key) ?? {
        aliases: new Set<string>(),
        family,
        style,
        text: '',
        weight,
        sources: [...sources],
      };

      requirement.aliases.add(rawFamily.split(',')[0] ?? rawFamily);
      requirement.aliases.add(family);
      requirement.text += node.text ?? '';
      requirements.set(key, requirement);
    }
    for (const child of node.children) {
      visit(child);
    }
  };

  for (const scene of scenes) {
    if (scene.sceneData !== undefined) {
      visit(scene.sceneData);
    }
  }

  return Array.from(requirements.values());
}

function parseFontWeight(value: string | undefined): number {
  if (value === undefined || value === 'normal') {
    return 400;
  }
  if (value === 'bold') {
    return 700;
  }
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 400;
}

function selectFaces(
  parsed: fontkit.Font | fontkit.FontCollection,
  preferredStyle: string | undefined,
): fontkit.Font[] {
  const faces = Array.isArray((parsed as fontkit.FontCollection).fonts)
    ? (parsed as fontkit.FontCollection).fonts
    : [parsed as fontkit.Font];

  if (preferredStyle === undefined || faces.length <= 1) {
    return faces;
  }
  const sorted = [...faces].sort((left, right) =>
    styleDistance(left.subfamilyName, preferredStyle) - styleDistance(right.subfamilyName, preferredStyle),
  );

  return sorted;
}

function registerFaceAlias(map: Map<string, fontkit.Font[]>, alias: string, face: fontkit.Font): void {
  const key = normalizeLookup(alias);

  if (key === '') {
    return;
  }
  const faces = map.get(key) ?? [];

  if (!faces.includes(face)) {
    faces.push(face);
    map.set(key, faces);
  }
}

async function fetchFontBytes(source: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(source);

    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function getQueryLocalFonts(): QueryLocalFonts | null {
  const candidate = globalThis as typeof globalThis & { queryLocalFonts?: QueryLocalFonts };

  return typeof candidate.queryLocalFonts === 'function' ? candidate.queryLocalFonts.bind(candidate) : null;
}

function collectDesiredLocalFamilies(requirements: FontRequirement[]): Array<{
  aliases: Set<string>;
  family: string;
  style: string;
}> {
  const desired = new Map<string, { aliases: Set<string>; family: string; style: string }>();

  for (const requirement of requirements) {
    desired.set(`${normalizeLookup(requirement.family)}::${normalizeLookup(requirement.style)}`, {
      aliases: requirement.aliases,
      family: requirement.family,
      style: requirement.style,
    });
  }
  const fallbackFamilies = ['Inter', 'Arial', 'Noto Sans'];
  const hasCJKText = requirements.some(requirement =>
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(requirement.text),
  );

  if (hasCJKText) {
    fallbackFamilies.push('Noto Sans SC', 'PingFang SC', 'Microsoft YaHei');
  }
  for (const family of fallbackFamilies) {
    const key = `${normalizeLookup(family)}::regular`;

    if (!desired.has(key)) {
      desired.set(key, { aliases: new Set([family]), family, style: 'Regular' });
    }
  }

  return Array.from(desired.values());
}

function fontFamilyMatches(localFamily: string, desired: { aliases: Set<string>; family: string }): boolean {
  const local = normalizeLookup(localFamily);
  const aliases = [desired.family, ...desired.aliases].map(normalizeLookup);

  if (aliases.includes(local)) {
    return true;
  }
  const wantsSimplifiedChinese = aliases.includes('noto sans sc');

  return wantsSimplifiedChinese && [
    'pingfang sc',
    'microsoft yahei',
    'heiti sc',
    'hiragino sans gb',
    'source han sans sc',
  ].includes(local);
}

function styleDistance(actual: string, expected: string): number {
  const left = normalizeLookup(actual).replace(/\s+/g, '');
  const right = normalizeLookup(expected).replace(/\s+/g, '');

  if (left === right) {
    return 0;
  }
  if (left === 'regular' || left === 'normal') {
    return 1;
  }

  return 2;
}

function hasFaceForRequirement(
  requirement: FontRequirement,
  facesByFamily: Map<string, fontkit.Font[]>,
  facesBySource: Map<string, fontkit.Font[]>,
): boolean {
  return requirement.sources.some(source => (facesBySource.get(source)?.length ?? 0) > 0) ||
    (facesByFamily.get(normalizeLookup(requirement.family))?.length ?? 0) > 0;
}

function createRuntime(
  facesByFamily: Map<string, fontkit.Font[]>,
  facesBySource: Map<string, fontkit.Font[]>,
  fallbackFaces: fontkit.Font[],
  glyphCoverage: BrowserTextGlyphCoverage,
): TextConversionRuntime {
  const candidateCache = new Map<string, fontkit.Font[]>();
  const familyNames = new WeakMap<fontkit.Font, string>();
  const glyphCache = new Map<string, number | null>();
  const variations = new WeakMap<fontkit.Font, Map<number, fontkit.Font>>();
  const faceIds = new WeakMap<object, number>();
  let nextFaceId = 1;

  const familyName = (face: fontkit.Font): string => {
    const cached = familyNames.get(face);

    if (cached !== undefined) {
      return cached;
    }
    const name = face.familyName;

    familyNames.set(face, name);

    return name;
  };
  const faceId = (face: fontkit.Font): number => {
    let id = faceIds.get(face);

    if (id === undefined) {
      id = nextFaceId++;
      faceIds.set(face, id);
    }

    return id;
  };
  const varyFace = (face: fontkit.Font, weight: number): fontkit.Font => {
    const axis = face.variationAxes?.wght;

    if (axis === undefined || !Number.isFinite(weight) || typeof face.getVariation !== 'function') {
      return face;
    }
    const target = Math.max(axis.min, Math.min(axis.max, weight));
    const cached = variations.get(face) ?? new Map<number, fontkit.Font>();
    const existing = cached.get(target);

    if (existing !== undefined) {
      return existing;
    }
    let varied = face;

    try {
      const candidate = face.getVariation({ wght: target });

      // Subset WOFF2 faces can lose their cmap when instantiated by fontkit.
      candidate.glyphForCodePoint(0);
      varied = candidate;
    } catch {
      // Retain the usable source face when its variation cannot be decoded.
    }
    cached.set(target, varied);
    variations.set(face, cached);

    return varied;
  };
  const candidates = (
    family: string, source: string | null | undefined, style: string, weight: number,
  ): fontkit.Font[] => {
    const key = JSON.stringify([
      normalizeLookup(family), source ?? null, normalizeLookup(style), Number.isFinite(weight) ? weight : null,
    ]);
    const cached = candidateCache.get(key);

    if (cached !== undefined) {
      return cached;
    }
    const result: fontkit.Font[] = [];
    const preferStyle = (faces: fontkit.Font[]): fontkit.Font[] => faces.toSorted((left, right) =>
      Number(normalizeLookup(right.subfamilyName) === normalizeLookup(style)) -
      Number(normalizeLookup(left.subfamilyName) === normalizeLookup(style)),
    );

    for (const face of [
      ...preferStyle(source === undefined || source === null ? [] : facesBySource.get(source) ?? []),
      ...preferStyle(facesByFamily.get(normalizeLookup(family)) ?? []),
      ...preferStyle(fallbackFaces),
    ]) {
      const varied = varyFace(face, weight);

      if (!result.includes(varied)) {
        result.push(varied);
      }
    }

    candidateCache.set(key, result);

    return result;
  };

  return {
    resolveFontFamily(fontFamily, fontStyle, fontSource, fontWeight) {
      const face = candidates(fontFamily, fontSource, fontStyle, fontWeight ?? 400)[0];

      if (face !== undefined && !glyphCoverage.fontResolutions.some(entry =>
        entry.requestedFamily === fontFamily && entry.resolvedFamily === familyName(face),
      )) {
        glyphCoverage.fontResolutions.push({
          requestedFamily: fontFamily, resolvedFamily: familyName(face), characters: [],
        });
      }

      return face === undefined ? null : resolveFigmaFontFamily(fontFamily, familyName(face));
    },
    getLigatureGlyphs(family, style, weight, source, text, store) {
      const face = candidates(family, source, style, weight).find(candidate =>
        Array.from(text).every(character => character.trim() === '' || hasGlyph(candidate, character)),
      );

      return shapeFontLigatures(face, text, store);
    },
    computeCharWidths(fontFamily, fontStyle, fontWeight, fontSource, text, fontSize) {
      if (Array.from(text).length !== text.length) {
        return null;
      }
      const face = candidates(fontFamily, fontSource, fontStyle, fontWeight).find(candidate =>
        Array.from(text).every(character => character.trim() === '' || hasGlyph(candidate, character)),
      );

      if (face === undefined || !Number.isFinite(fontSize) || fontSize <= 0) {
        return null;
      }
      try {
        const layout = face.layout(text);

        if (layout.glyphs.length !== text.length || layout.positions.length !== text.length) {
          return null;
        }
        const unitsPerEm = Number(face.unitsPerEm || 1000);

        return layout.positions.map((position, index) => {
          const fallbackAdvance = Number(layout.glyphs[index]?.advanceWidth || 0);
          const advance = Number.isFinite(position.xAdvance) ? position.xAdvance : fallbackAdvance;

          return (advance / unitsPerEm) * fontSize;
        });
      } catch {
        return null;
      }
    },
    getGlyphBlobIndex(fontFamily, fontStyle, fontWeight, fontSource, character, blobStore) {
      const shouldTrack = character.trim() !== '';

      if (shouldTrack) {
        glyphCoverage.requested += 1;
      }
      const face = candidates(fontFamily, fontSource, fontStyle, fontWeight)
        .find(candidate => hasGlyph(candidate, character));

      if (face === undefined) {
        recordMissingGlyph(glyphCoverage, character, shouldTrack);

        return null;
      }
      if (shouldTrack) {
        let resolution = glyphCoverage.fontResolutions.find(entry =>
          entry.requestedFamily === fontFamily && entry.resolvedFamily === familyName(face),
        );

        if (resolution === undefined) {
          resolution = { requestedFamily: fontFamily, resolvedFamily: familyName(face), characters: [] };
          glyphCoverage.fontResolutions.push(resolution);
        }
        if (!resolution.characters.includes(character)) {
          resolution.characters.push(character);
        }
      }
      const key = `${faceId(face)}::${character}`;
      const cached = glyphCache.get(key);

      if (cached !== undefined) {
        if (shouldTrack) {
          if (cached === null) {
            recordMissingGlyph(glyphCoverage, character, true);
          } else {
            glyphCoverage.resolved += 1;
          }
        }

        return cached;
      }
      try {
        const glyph = face.glyphForCodePoint(character.codePointAt(0) ?? 0);
        const blob = encodeGlyphCommandsBlob(glyph.path, Number(face.unitsPerEm || 1000));
        const index = blobStore.add('glyph', blob);

        glyphCache.set(key, index);
        if (shouldTrack) {
          glyphCoverage.resolved += 1;
        }

        return index;
      } catch {
        glyphCache.set(key, null);
        recordMissingGlyph(glyphCoverage, character, shouldTrack);

        return null;
      }
    },
  };
}

function recordMissingGlyph(
  coverage: BrowserTextGlyphCoverage,
  character: string,
  shouldTrack: boolean,
): void {
  if (!shouldTrack) {
    return;
  }
  if (!coverage.missingCharacters.includes(character)) {
    coverage.missingCharacters.push(character);
  }
}

function hasGlyph(face: fontkit.Font, character: string): boolean {
  const codePoint = character.codePointAt(0);

  if (codePoint === undefined) {
    return false;
  }
  try {
    const glyph = face.glyphForCodePoint(codePoint);

    return glyph.id !== 0 && !String(glyph.name ?? '').toLowerCase().includes('.notdef');
  } catch {
    return false;
  }
}

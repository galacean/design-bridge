import type { ClipboardBlobStore } from './clipboard-blob-store';

export interface TextConversionRuntime {
  getLigatureGlyphs?(
    family: string, style: string, weight: number, source: string | null | undefined,
    text: string, store: ClipboardBlobStore,
  ): Array<{ firstCharacter: number; characterCount: number; commandsBlob: number }>;
  resolveFontFamily(
    fontFamily: string,
    fontStyle: string,
    fontSource: string | null | undefined,
    fontWeight: number,
  ): string | null;
  computeCharWidths(
    fontFamily: string,
    fontStyle: string,
    fontWeight: number,
    fontSource: string | null | undefined,
    text: string,
    fontSize: number,
  ): number[] | null;
  getGlyphBlobIndex(
    fontFamily: string,
    fontStyle: string,
    fontWeight: number,
    fontSource: string | null | undefined,
    character: string,
    blobStore: ClipboardBlobStore,
  ): number | null;
}

export const BASIC_TEXT_CONVERSION_RUNTIME: TextConversionRuntime = {
  resolveFontFamily: () => null,
  computeCharWidths: () => null,
  getGlyphBlobIndex: () => null,
};

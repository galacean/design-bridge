/** Discriminants for image and font entries in the Scene asset registry. */
export const IRAssetType = {
  Image: 'image',
  Font: 'font',
} as const;

/** Resource storage kinds; system lookup is supported only for fonts. */
export const IRAssetSourceKind = {
  Url: 'url',
  Embedded: 'embedded',
  /** Only valid for Font assets. */
  System: 'system',
} as const;

/** External resource at an absolute non-data URL. */
export interface IRUrlResourceSource {
  kind: typeof IRAssetSourceKind.Url;
  url: string;
}

/** Resource bytes embedded directly in the IR as canonical Base64. */
export interface IREmbeddedResourceSource {
  kind: typeof IRAssetSourceKind.Embedded;
  mimeType: string;
  /** Standard Base64 without a Data URL prefix or whitespace. */
  data: string;
}

/** Portable resource location: an absolute URL or embedded bytes, discriminated by kind. */
export type IRResourceSource = IRUrlResourceSource | IREmbeddedResourceSource;

/** Font resolved from the consumer environment; availability and metrics are not portable. */
export interface IRSystemFontSource {
  kind: typeof IRAssetSourceKind.System;
}

/** Font bytes or a consumer-provided system font; system fonts are not portable across environments. */
export type IRFontSource = IRResourceSource | IRSystemFontSource;

/** Image resource referenced by Layer or texture-paint asset IDs; display bounds belong to the consumer. */
export interface IRImageAsset {
  id: string;
  type: typeof IRAssetType.Image;
  source: IRResourceSource;
}

/** Font face referenced by text Layers; family, style and weight identify the requested face. */
export interface IRFontAsset {
  id: string;
  type: typeof IRAssetType.Font;
  family: string;
  style: 'normal' | 'italic' | 'oblique';
  /** Integer OpenType weight in the 1..1000 range. */
  weight: number;
  source: IRFontSource;
}

/** Scene-level resource, discriminated by type and referenced through a Scene-unique ID. */
export type IRAsset = IRImageAsset | IRFontAsset;

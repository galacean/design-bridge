// ---- Scene types (output from extractScene) ----

/** Captured CSS values retained alongside the scene's resolved semantic Figma properties. */
export interface SceneStyles {
  backgroundColor?: string;
  color?: string;
  opacity?: string;
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  fontStyle?: string;
  fontVariantLigatures?: string;
  fontFeatureSettings?: string;
  textAlign?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textTransform?: string;
  textDecoration?: string;
  borderRadius?: string;
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomLeftRadius?: string;
  borderBottomRightRadius?: string;
  borderTopWidth?: string;
  borderTopColor?: string;
  borderTopStyle?: string;
  borderRightWidth?: string;
  borderRightStyle?: string;
  borderBottomWidth?: string;
  borderBottomStyle?: string;
  borderLeftWidth?: string;
  borderLeftStyle?: string;
  boxShadow?: string;
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  flexWrap?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  backgroundImage?: string;
  maskImage?: string;
  webkitMaskImage?: string;
  overflow?: string;
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  maxHeight?: string;
  flexGrow?: string;
  flexShrink?: string;
  alignSelf?: string;
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridColumn?: string;
  gridRow?: string;
  gridColumnStart?: string;
  gridColumnEnd?: string;
  gridRowStart?: string;
  gridRowEnd?: string;
  objectFit?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  placeholderColor?: string;
}

/** Browser-measured text metrics in CSS pixels for editable text layout. */
export interface TextCharMetrics {
  /** Per-character font advances before CSS letter spacing is added during export. */
  charWidths: number[];
  /** Font ascent above the alphabetic baseline. */
  ascent: number;
  /** Measured font line height before CSS line-height is applied. */
  fontLineHeight: number;
  /** First baseline relative to the scene text box, measured from DOM geometry. */
  baselineOffset?: number;
  /** Browser-measured UTF-16 character advances and baselines relative to the text box (simple horizontal LTR text). */
  characterPositions?: Array<{ x: number; y: number; advance: number }>;
}

// ---- Figma IR types (semantic Figma properties, computed during extraction) ----

/** Figma node type determined at extraction time */
export type FigmaIRNodeType = 'FRAME' | 'TEXT' | 'RECTANGLE' | 'ROUNDED_RECTANGLE' | 'VECTOR' | 'IMAGE';

/** Solid fill resolved from CSS */
export interface FigmaIRSolidFill {
  type: 'SOLID';
  color: RGBA;
}

/** Gradient fill resolved from CSS */
export interface FigmaIRGradientFill {
  type: 'GRADIENT_LINEAR';
  stops: Array<{ color: RGBA; position: number }>;
  angleDeg: number;
}

export type FigmaIRFill = FigmaIRSolidFill | FigmaIRGradientFill;

/** Shadow effect resolved from CSS box-shadow */
export interface FigmaIRShadowEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW';
  color: RGBA;
  offset: { x: number; y: number };
  radius: number;
  spread: number;
  showShadowBehindNode?: boolean;
}

/** Background blur effect */
export interface FigmaIRBackgroundBlurEffect {
  type: 'BACKGROUND_BLUR';
  radius: number;
  visible?: boolean;
  blurOpType?: 'NORMAL';
}

/** Layer blur applied to the node and its children. */
export interface FigmaIRForegroundBlurEffect {
  type: 'FOREGROUND_BLUR';
  radius: number;
  visible?: boolean;
  blurOpType?: 'NORMAL';
}

export type FigmaIREffect = FigmaIRShadowEffect | FigmaIRBackgroundBlurEffect | FigmaIRForegroundBlurEffect;

/** Auto layout resolved from CSS flex/grid */
export interface FigmaIRAutoLayout {
  stackMode: 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  stackSpacing?: number;
  stackCounterSpacing?: number;
  stackVerticalPadding?: number;
  stackHorizontalPadding?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  stackPrimaryAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' | 'SPACE_EVENLY';
  stackCounterAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  stackWrap?: 'WRAP';
  stackPrimarySizing?: 'FIXED' | 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
  stackCounterSizing?: 'FIXED' | 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
  gridColumns?: number[];
  gridRows?: number[];
  gridRowGap?: number;
  gridColumnGap?: number;
}

/** Border resolved from CSS */
export interface FigmaIRBorder {
  color: RGBA;
  width: number;
  style?: 'SOLID' | 'DASHED' | 'DOTTED';
  /** Stroke position relative to the measured geometry; omitted preserves the converter default. */
  alignment?: 'INSIDE' | 'CENTER' | 'OUTSIDE';
}

/** Corner radii resolved from CSS */
export interface FigmaIRCornerRadii {
  tl: number;
  tr: number;
  bl: number;
  br: number;
  allSame: boolean;
}

/** Text properties resolved from CSS */
export interface FigmaIRTextProps {
  fontFamily: string;
  fontWeight: number;
  fontStyle?: string;
  fontSize: number;
  lineHeightPx: number;
  letterSpacing: number;
  textAlign: 'LEFT' | 'CENTER' | 'RIGHT';
  textDecoration?: 'UNDERLINE' | 'STRIKETHROUGH';
  textCase?: 'UPPER' | 'LOWER' | 'TITLE';
  textTransform?: string;
  color: RGBA;
}

/** Grid placement hint resolved from CSS grid-column/grid-row */
export interface FigmaIRGridPlacement {
  row: number | null;
  col: number | null;
  rowSpan: number;
  colSpan: number;
}

/** CSS sizing semantics resolved from CSS width/height/display */
export interface FigmaIRSizing {
  /** Width sizing mode: FIXED=explicit width, AUTO=content-sized, FILL=stretch to parent */
  widthMode: 'FIXED' | 'AUTO' | 'FILL';
  /** Height sizing mode: FIXED=explicit height, AUTO=content-sized, FILL=stretch to parent */
  heightMode: 'FIXED' | 'AUTO' | 'FILL';
  /** Whether the element is block-level (block, flex, grid, list-item, etc.) */
  isBlockLevel: boolean;
}

/** Figma IR — semantic layer computed in browser context */
export interface FigmaIR {
  /** Figma node type */
  figmaType: FigmaIRNodeType;
  /** Opacity (0..1) */
  opacity: number;
  /** Whether element is position:absolute/fixed */
  isAbsolute: boolean;
  /** Constraint hints for absolute elements */
  absoluteConstraints?: {
    horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
    vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  };
  /** Fill paints */
  fills: FigmaIRFill[];
  /** Border/stroke */
  border?: FigmaIRBorder;
  /** Corner radii */
  cornerRadii?: FigmaIRCornerRadii;
  /** Shadow effects */
  effects: FigmaIREffect[];
  /** Auto layout (for frames with flex/grid) */
  autoLayout?: FigmaIRAutoLayout;
  /** Text properties (for text nodes) */
  textProps?: FigmaIRTextProps;
  /** Grid placement hint for children of grid containers */
  gridPlacement?: FigmaIRGridPlacement;
  /** Overflow clipping */
  clipsContent: boolean;
  /** CSS flexGrow for sizing */
  flexGrow: number;
  /** CSS alignSelf mapped to Figma */
  alignSelf?: 'AUTO' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE';
  /** CSS sizing semantics (width/height mode) */
  sizing?: FigmaIRSizing;
}

/** A measured HTML scene node with captured resources and semantic Figma properties. */
export interface SceneNode {
  /** Extracted content category. */
  type: 'frame' | 'text' | 'image' | 'svg' | 'icon';
  /** Layer name used during export. */
  name: string;
  /** Measured horizontal position in scene coordinates, in CSS pixels. */
  x: number;
  /** Measured vertical position in scene coordinates, in CSS pixels. */
  y: number;
  /** Measured width in CSS pixels. */
  width: number;
  /** Measured height in CSS pixels. */
  height: number;
  /** Extracted source text, also retained as metadata for rasterized text. */
  text?: string | null;
  /** Serialized SVG markup when captured. */
  svg?: string | null;
  /** Captured image data URL when available. */
  image?: string | null;
  /** Captured CSS background image data URL when available. */
  backgroundImage?: string | null;
  /** Primary font source: a URL during extraction or a hydrated local path in Node.js. */
  fontSource?: string | null;
  /** Ordered font sources retained for export-time font resolution. */
  fontSources?: string[];
  /** Captured CSS properties. */
  styles: SceneStyles;
  /** Child nodes in the extracted scene hierarchy. */
  children: SceneNode[];
  tagName?: string;
  role?: string;
  ariaLabel?: string;
  iconName?: string;
  /** Simple filled SVG paths for vector-backed nodes; color comes from IR fills. */
  svgContent?: string;
  textMetrics?: TextCharMetrics;
  /** Marks this node as a Figma mask source node */
  mask?: boolean;
  /** Figma mask type (currently ALPHA for CSS mask-image) */
  maskType?: 'ALPHA' | 'VECTOR';
  /** Figma IR — pre-computed semantic Figma properties */
  ir: FigmaIR;
}

/** A named scene supplied to clipboard and file exporters; failed or absent scenes are skipped. */
export interface SceneResult {
  /** Top-level exported scene name. */
  name: string;
  /** Extraction failure, when present. Exporters skip scenes with a non-empty error. */
  error?: string;
  /** Extracted scene root, absent when extraction failed. */
  sceneData?: SceneNode;
}

// ---- Figma types ----

/** Red, green, blue, and alpha components normalized to the range from 0 to 1. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaGUID {
  sessionID: number;
  localID: number;
}

export interface FigmaMatrix {
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface FigmaVector {
  x: number;
  y: number;
}

export interface FigmaColorStop {
  color: RGBA;
  position: number;
}

export interface FigmaPaint {
  type: string;
  color?: RGBA;
  opacity: number;
  visible: boolean;
  blendMode: string;
  stops?: FigmaColorStop[];
  transform?: FigmaMatrix;
  image?: {
    hash: number[];
    name: string;
    dataBlob?: number;
  };
  animationFrame?: number;
  imageScaleMode?: string;
  rotation?: number;
  scale?: number;
}

export interface FigmaEffect {
  type: string;
  color?: RGBA;
  offset?: FigmaVector;
  radius: number;
  spread?: number;
  visible: boolean;
  blurOpType?: 'NORMAL';
  showShadowBehindNode?: boolean;
}

export interface FigmaTextDataGlyph {
  commandsBlob?: number;
  position?: { x: number; y: number };
  fontSize?: number;
  firstCharacter?: number;
  advance?: number;
  [key: string]: unknown;
}

export interface FigmaTextDataLine {
  lineType: string;
  indentationLevel: number;
  sourceDirectionality: string;
}

export interface FigmaTextDataBaseline {
  position: { x: number; y: number };
  width: number;
  lineY: number;
  lineHeight: number;
  lineAscent: number;
  firstCharacter: number;
  endCharacter: number;
}

export interface FigmaTextDataFontMeta {
  key: { family: string; style: string; postscript: string } | undefined;
  fontLineHeight: number;
  fontStyle: 'NORMAL';
  fontWeight: number;
}

export interface FigmaTextDataFallbackFont {
  family: string;
  style: string;
  postscript: string;
}

export interface FigmaTextData {
  characters?: string;
  lines?: FigmaTextDataLine[];
  layoutVersion?: number;
  layoutSize?: { x: number; y: number };
  baselines?: FigmaTextDataBaseline[];
  glyphs?: FigmaTextDataGlyph[];
  fontMetaData?: FigmaTextDataFontMeta[];
  decorations?: unknown[];
  logicalIndexToCharacterOffsetMap?: number[];
  truncationStartIndex?: number;
  truncatedHeight?: number;
  fallbackFonts?: FigmaTextDataFallbackFont[];
  [key: string]: unknown;
}

export interface FigmaNodeChange {
  guid: FigmaGUID;
  phase?: string;
  parentIndex?: { guid: FigmaGUID; position: string };
  type: string;
  name: string;
  visible: boolean;
  locked?: boolean;
  opacity: number;
  blendMode?: string;
  size?: FigmaVector;
  transform?: FigmaMatrix;
  dashPattern?: number[];
  strokeWeight?: number;
  strokeAlign?: string;
  strokeJoin?: string;
  effects?: FigmaEffect[];
  fillPaints?: FigmaPaint[];
  strokePaints?: FigmaPaint[];
  horizontalConstraint?: string;
  verticalConstraint?: string;
  cornerRadius?: number;
  rectangleTopLeftCornerRadius?: number;
  rectangleTopRightCornerRadius?: number;
  rectangleBottomLeftCornerRadius?: number;
  rectangleBottomRightCornerRadius?: number;
  rectangleCornerRadiiIndependent?: boolean;
  stackMode?: string;
  stackSpacing?: number;
  stackCounterSpacing?: number;
  stackVerticalPadding?: number;
  stackHorizontalPadding?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  stackPrimaryAlignItems?: string;
  stackCounterAlignItems?: string;
  stackReverseZIndex?: boolean;
  stackCounterSizing?: string;
  stackPrimarySizing?: string;
  stackChildAlignSelf?: string;
  stackPositioning?: string;
  stackChildPrimaryGrow?: number;
  stackWrap?: string;
  frameMaskDisabled?: boolean;
  mask?: boolean;
  maskType?: 'ALPHA' | 'VECTOR';
  fontSize?: number;
  fontName?: { family: string; style: string; postscript: string };
  lineHeight?: { value: number; units: string };
  letterSpacing?: { value: number; units: string };
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textAutoResize?: string;
  textData?: FigmaTextData;
  derivedTextData?: FigmaTextData;
  emojiImageSet?: string;
  textDecoration?: string;
  textCase?: string;
  textTracking?: number;
  vectorData?: { vectorNetworkBlob: number };
  bordersTakeSpace?: boolean;
  backgroundOpacity?: number;
  backgroundEnabled?: boolean;
  autoRename?: boolean;
  gridRows?: Record<string, unknown>;
  gridColumns?: Record<string, unknown>;
  gridRowGap?: number;
  gridColumnGap?: number;
  gridColumnsSizing?: Record<string, unknown>;
  gridRowsSizing?: Record<string, unknown>;
  gridRowAnchor?: FigmaGUID;
  gridColumnAnchor?: FigmaGUID;
  gridColumnSpan?: number;
  _gridInfo?: GridInfo;
  [key: string]: unknown;
}

export interface GridInfo {
  rowGUIDs: FigmaGUID[];
  colGUIDs: FigmaGUID[];
  numCols: number;
  numRows: number;
  placements?: Array<{
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
  } | null>;
}

export interface FigmaBlob {
  bytes: number[];
}

// ---- SVG types ----

export interface SvgPathCommand {
  type: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

export interface VectorVertex {
  handleMirroring: number;
  x: number;
  y: number;
}

export interface VectorSegment {
  flags: number;
  start: number;
  tangentStartX: number;
  tangentStartY: number;
  end: number;
  tangentEndX: number;
  tangentEndY: number;
}

export interface VectorNetwork {
  vertices: VectorVertex[];
  segments: VectorSegment[];
  loops: number[][];
}

export interface VectorBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgParseResult {
  paths: string[];
  viewBox: number[];
  fillRule: string;
}

// ---- Auto layout types ----

export interface AutoLayout {
  stackMode: string;
  stackSpacing?: number;
  stackCounterSpacing?: number;
  stackVerticalPadding?: number;
  stackHorizontalPadding?: number;
  stackPaddingLeft?: number;
  stackPaddingTop?: number;
  stackPaddingRight?: number;
  stackPaddingBottom?: number;
  stackPrimaryAlignItems?: string;
  stackCounterAlignItems?: string;
  stackReverseZIndex?: boolean;
  stackCounterSizing?: string;
  stackPrimarySizing?: string;
  stackChildAlignSelf?: string;
  stackWrap?: string;
  gridRowGap?: number;
  gridColumnGap?: number;
  _gridColumns?: number[];
  _gridRows?: number[];
  _inferredAxisScore?: number;
  _inferredChildCount?: number;
  _inferredGapCount?: number;
}

export interface CornerRadii {
  tl: number;
  tr: number;
  bl: number;
  br: number;
  allSame: boolean;
  radius: number;
}

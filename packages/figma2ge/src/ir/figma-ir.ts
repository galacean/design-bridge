export interface FigmaIRGradientStop {
  position: number;
  color: [number, number, number, number];
}

export interface FigmaIRGradientHandle {
  x: number;
  y: number;
}

export interface FigmaIRGradientPaint {
  type: 'linear' | 'radial' | 'angular' | 'diamond';
  stops: FigmaIRGradientStop[];
  handles?: FigmaIRGradientHandle[];
}

export interface FigmaIRFill {
  type: 'solid' | 'gradient' | 'image';
  color?: [number, number, number, number];
  gradient?: FigmaIRGradientPaint;
  imageRef?: string;
  imageScaleMode?: 'STRETCH' | 'FIT' | 'FILL' | 'TILE';
  dataBlobIndex?: number;
  opacity?: number;
  visible?: boolean;
}

export interface FigmaIRStroke {
  type: 'solid' | 'gradient';
  color?: [number, number, number, number];
  gradient?: FigmaIRGradientPaint;
  width?: number;
  align?: 'CENTER' | 'INSIDE' | 'OUTSIDE';
  cap?: 'NONE' | 'ROUND' | 'SQUARE';
  join?: 'MITER' | 'BEVEL' | 'ROUND';
  dashPattern?: number[];
  opacity?: number;
  visible?: boolean;
}

export interface FigmaIREffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'FOREGROUND_BLUR' | 'BACKGROUND_BLUR';
  visible: boolean;
  color?: [number, number, number, number];
  offset?: { x: number; y: number };
  radius: number;
  spread?: number;
}

export type FigmaIRNodeKind = 'frame' | 'group' | 'text' | 'vector' | 'shape' | 'unknown';

export interface FigmaIRNode {
  id: string;
  name: string;
  kind: FigmaIRNodeKind;
  figmaType: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;

  rotation?: number;
  blendMode?: string;
  clipContent?: boolean;

  /** Whether this node acts as a mask for its siblings. */
  isMask?: boolean;
  /** Mask type: 'ALPHA' | 'OUTLINE' | 'LUMINANCE'. Only meaningful when isMask is true. */
  maskType?: 'ALPHA' | 'OUTLINE' | 'LUMINANCE';

  fills?: FigmaIRFill[];
  strokes?: FigmaIRStroke[];
  effects?: FigmaIREffect[];

  fillColor?: [number, number, number, number];
  fillGradient?: FigmaIRGradientPaint;
  textColor?: [number, number, number, number];
  imageRef?: string;
  imageBlobIndex?: number;
  strokeColor?: [number, number, number, number];
  strokeWidth?: number;

  text?: string;
  textFontSize?: number;
  textLineHeight?: number;
  textFontFamily?: string;
  textFontWeight?: number;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  letterSpacing?: number;

  cornerRadius?: number;
  cornerRadii?: [number, number, number, number];
  cornerSmoothing?: number;

  /** Parsed vector fill geometry paths (from fillGeometry commandsBlob). */
  fillPaths?: FigmaIRPath[];
  /** Parsed vector stroke geometry paths (from strokeGeometry commandsBlob). */
  strokePaths?: FigmaIRPath[];

  // Shape-specific properties
  /** Number of points for STAR / REGULAR_POLYGON */
  shapePointCount?: number;
  /** Inner-to-outer radius ratio for STAR shapes */
  starInnerScale?: number;
  /** Arc data for ELLIPSE (startingAngle, endingAngle, innerRadius) */
  arcData?: { startingAngle: number; endingAngle: number; innerRadius: number };

  // Auto-layout (Figma Stack)
  autoLayout?: FigmaIRAutoLayout;
  // Auto-layout child properties
  layoutGrow?: number;
  layoutAlignSelf?: 'AUTO' | 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';

  children: FigmaIRNode[];
}

export type FigmaIRPathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }
  | { type: 'Z' };

export interface FigmaIRPath {
  commands: FigmaIRPathCommand[];
  windingRule?: 'NONZERO' | 'EVENODD';
}

export type FigmaIRAutoLayoutDirection = 'HORIZONTAL' | 'VERTICAL';

export interface FigmaIRAutoLayout {
  direction: FigmaIRAutoLayoutDirection;
  spacing: number;
  counterSpacing?: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  primaryAlign: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' | 'SPACE_EVENLY';
  counterAlign: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  wrap?: boolean;
  primarySizing?: 'FIXED' | 'HUG';
  counterSizing?: 'FIXED' | 'HUG';
}

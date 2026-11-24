export const DEFAULT_FONT_FALLBACK_FAMILIES = [
  'Inter', 'Arial', 'Helvetica Neue', 'Helvetica', 'Roboto', 'Noto Sans', 'Noto Sans SC', 'Noto Sans TC',
  'PingFang SC', 'Microsoft YaHei', 'sans-serif',
];

const GENERIC_FONT_KEYWORDS = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont',
]);

const FIGMA_GOOGLE_FONTS = new Set([
  'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Ubuntu', 'Merriweather', 'PT Sans',
  'PT Serif', 'Playfair Display', 'Oswald', 'Source Sans Pro', 'Source Sans 3', 'Source Code Pro', 'Noto Sans',
  'Noto Serif', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans TC', 'Roboto Mono', 'Roboto Slab',
  'Roboto Condensed', 'Work Sans', 'DM Sans', 'DM Serif Display', 'DM Mono', 'Fira Sans', 'Fira Code', 'Fira Mono',
  'IBM Plex Sans', 'IBM Plex Mono', 'Barlow', 'Barlow Condensed', 'Manrope', 'Space Grotesk', 'Space Mono',
  'Plus Jakarta Sans', 'Outfit', 'Lexend', 'Sora', 'Urbanist', 'Archivo', 'Red Hat Display', 'Red Hat Text', 'Bitter',
  'Libre Franklin', 'Mulish', 'Quicksand', 'Rubik', 'Karla', 'Cabin', 'Hind', 'Crimson Text', 'Libre Baskerville',
  'EB Garamond', 'Cormorant Garamond', 'Josefin Sans', 'Exo 2', 'Titillium Web', 'Comfortaa', 'Heebo',
  'Chakra Petch', 'JetBrains Mono', 'Inconsolata', 'Overpass', 'Alegreya', 'Zilla Slab', 'Assistant', 'Maven Pro',
  'Signika',
]);

const FIGMA_SYSTEM_FONTS = new Set([
  'Inter', 'Arial', 'Helvetica', 'Helvetica Neue', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana',
  'Trebuchet MS', 'Tahoma', 'Impact', 'Segoe UI', 'SF Pro', 'SF Pro Display', 'SF Pro Text', 'Noto Sans SC',
  'Noto Sans TC', 'Noto Sans JP', 'Noto Sans KR',
]);

const CHINESE_FONT_ALIASES = new Map([
  ['pingfang sc', 'Noto Sans SC'],
  ['microsoft yahei', 'Noto Sans SC'],
  ['heiti sc', 'Noto Sans SC'],
  ['hiragino sans gb', 'Noto Sans SC'],
  ['source han sans sc', 'Noto Sans SC'],
  ['source han serif sc', 'Noto Sans SC'],
]);

export function normalizeFontFamily(cssFontFamily: string | undefined): string {
  if (cssFontFamily === undefined || cssFontFamily === '') {
    return 'Inter';
  }

  for (const family of cssFontFamily.split(',')) {
    let cleaned = family.trim().replace(/["']/g, '');

    if (cleaned === '') {
      continue;
    }

    const lower = cleaned.toLowerCase();

    if (GENERIC_FONT_KEYWORDS.has(lower)) {
      continue;
    }
    if (cleaned.includes('_') && !cleaned.includes(' ')) {
      cleaned = cleaned.replace(/_/g, ' ');
    }
    if (FIGMA_GOOGLE_FONTS.has(cleaned) || FIGMA_SYSTEM_FONTS.has(cleaned)) {
      return cleaned;
    }

    const knownFont = findKnownFont(cleaned);

    if (knownFont !== undefined) {
      return knownFont;
    }

    const lowerKey = cleaned.toLowerCase();
    const alias = CHINESE_FONT_ALIASES.get(lowerKey);

    if (alias !== undefined) {
      return alias;
    }

    if (
      lowerKey.includes('pingfang') || lowerKey.includes('yahei') || lowerKey.includes('heiti') ||
      lowerKey.includes('source han') || lowerKey.includes('hiragino')
    ) {
      return 'Noto Sans SC';
    }

    return cleaned;
  }

  return 'Inter';
}

function findKnownFont(fontFamily: string): string | undefined {
  const normalized = fontFamily.toLowerCase();

  for (const candidate of FIGMA_GOOGLE_FONTS) {
    if (candidate.toLowerCase() === normalized) {
      return candidate;
    }
  }
  for (const candidate of FIGMA_SYSTEM_FONTS) {
    if (candidate.toLowerCase() === normalized) {
      return candidate;
    }
  }

  return undefined;
}

export function mapFontStyle(weightNum: number, fontFamily: string, cssFontStyle = 'normal'): string {
  const weightStyle = mapFontWeightStyle(weightNum, fontFamily);

  if (cssFontStyle.trim().toLowerCase() !== 'italic') {
    return weightStyle;
  }

  return weightStyle === 'Regular' ? 'Italic' : `${weightStyle} Italic`;
}

function mapFontWeightStyle(weightNum: number, fontFamily: string): string {
  const usesSpacedWeightNames = FIGMA_SYSTEM_FONTS.has(fontFamily) && !FIGMA_GOOGLE_FONTS.has(fontFamily);

  if (weightNum >= 900) {
    return 'Black';
  }
  if (weightNum >= 800) {
    return usesSpacedWeightNames ? 'Extra Bold' : 'ExtraBold';
  }
  if (weightNum >= 700) {
    return 'Bold';
  }
  if (weightNum >= 600) {
    return usesSpacedWeightNames ? 'Semi Bold' : 'SemiBold';
  }
  if (weightNum >= 500) {
    return 'Medium';
  }
  if (weightNum >= 400) {
    return 'Regular';
  }
  if (weightNum >= 300) {
    return 'Light';
  }
  if (weightNum >= 200) {
    return usesSpacedWeightNames ? 'Extra Light' : 'ExtraLight';
  }
  if (weightNum >= 100) {
    return 'Thin';
  }

  return 'Regular';
}

export function resolveFigmaFontFamily(requestedFamily: string, loadedFamily: string | null | undefined): string {
  const requested = normalizeFontFamily(requestedFamily);
  const loaded = (loadedFamily ?? '').trim();

  if (loaded === '') {
    return requested;
  }
  const loadedWithoutWeight = loaded.replace(
    /\s+(?:thin|extra\s*light|light|regular|medium|semi\s*bold|bold|extra\s*bold|black)$/i,
    '',
  );

  return loadedWithoutWeight.toLowerCase() === requested.toLowerCase() ? requested : loaded;
}

export function shouldEmitFallbackFonts(fontFamily: string, text: string): boolean {
  const normalized = fontFamily.toLowerCase();
  const cjkFamily =
    normalized.includes('noto sans sc') || normalized.includes('noto sans tc') ||
    normalized.includes('noto sans jp') || normalized.includes('noto sans kr');

  return cjkFamily || /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(text);
}

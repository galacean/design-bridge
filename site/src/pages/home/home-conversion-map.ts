export const homeConversionNodes = [
  { id: 'lottie', label: 'Lottie', detail: 'JSON / ZIP', desktop: [0, 35, 110, 104], mobile: [0, 20, 82, 80] },
  { id: 'svg', label: 'SVG', detail: '<path />', desktop: [0, 175, 110, 104], mobile: [0, 130, 82, 80] },
  {
    id: 'ir',
    label: 'Animation IR',
    detail: 'layers / tracks',
    desktop: [210, 90, 160, 170],
    mobile: [112, 70, 112, 140],
  },
  {
    id: 'ge',
    label: 'Galacean Effects',
    detail: 'JSONScene',
    desktop: [510, 90, 160, 170],
    mobile: [254, 70, 96, 140],
  },
  { id: 'dsl', label: 'DSL', detail: '{ compositions }', desktop: [210, 310, 160, 95], mobile: [112, 255, 112, 78] },
  { id: 'html', label: 'HTML / CSS', detail: '<div />', desktop: [0, 445, 110, 90], mobile: [0, 390, 82, 72] },
  {
    id: 'figma',
    label: 'Figma',
    detail: '.fig / clipboard',
    desktop: [210, 445, 160, 90],
    mobile: [112, 390, 112, 72],
  },
  { id: 'shader', label: 'GLSL', detail: 'fragment shader', desktop: [510, 350, 160, 95], mobile: [254, 255, 96, 78] },
] as const;

export const homeConversionEdges = [
  { from: 'lottie', to: 'ir', fromSide: 'right', toSide: 'left', bidirectional: false, package: 'lottie2ir' },
  { from: 'svg', to: 'ir', fromSide: 'right', toSide: 'left', bidirectional: false, package: 'svg2ir' },
  { from: 'ir', to: 'ge', fromSide: 'right', toSide: 'left', bidirectional: true, package: 'ge-ir' },
  { from: 'ir', to: 'dsl', fromSide: 'bottom', toSide: 'top', bidirectional: true, package: 'dsl-ir' },
  { from: 'html', to: 'figma', fromSide: 'right', toSide: 'left', bidirectional: false, package: 'html2figma' },
  { from: 'figma', to: 'ge', fromSide: 'right', toSide: 'left', bidirectional: false, package: 'figma2ge' },
  { from: 'shader', to: 'ge', fromSide: 'top', toSide: 'bottom', bidirectional: false, package: 'shader2ge' },
] as const;

export const homeCapabilityGroups = [
  { key: 'import', title: 'pathImportTitle', description: 'pathImportDescription', packages: ['lottie2ir', 'svg2ir'] },
  {
    key: 'edit',
    title: 'pathTransformTitle',
    description: 'pathTransformDescription',
    packages: ['animation-ir', 'ge-ir', 'dsl-ir'],
  },
  {
    key: 'design',
    title: 'pathDesignTitle',
    description: 'pathDesignDescription',
    packages: ['html2figma', 'figma2ge'],
  },
  { key: 'shader', title: 'pathRenderTitle', description: 'pathRenderDescription', packages: ['shader2ge'] },
] as const;

export const homePackagePaths = {
  'animation-ir': 'Animation IR',
  lottie2ir: 'Lottie \u2192 IR',
  svg2ir: 'SVG \u2192 IR / GE / layers',
  'ge-ir': 'GE \u2194 IR',
  'dsl-ir': 'DSL \u2194 IR',
  html2figma: 'HTML / CSS \u2192 Figma',
  figma2ge: 'Figma \u2192 GE',
  shader2ge: 'GLSL \u2192 GE',
} as const;

import type { FontDefine, JSONScene } from '@galacean/effects-specification';

/** 将调用方提供的字体定义写入 Effects Runtime 场景。 */
export function applyFonts (scene: JSONScene, fonts?: readonly { fontFamily: string; fontURL: string }[]): void {
  if (fonts == null || fonts.length === 0) { return; }
  const definitions: FontDefine[] = fonts.map(f => ({
    fontFamily: f.fontFamily,
    fontURL: f.fontURL,
  }));

  scene.fonts = definitions;
}

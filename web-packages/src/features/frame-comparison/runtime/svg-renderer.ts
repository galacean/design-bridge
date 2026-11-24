import { inlineSvgImages } from '../../../utils/svg-inline-images';
import { namespaceSvgStyles, namespaceSvgStyleUrls } from './namespace-svg-styles';

let svgPlaybackNamespaceSequence = 0;

/**
 * Capture SVG as canvas pixels. Canvas cannot draw an SVG DOM element directly, and an
 * SVG loaded through <img> cannot be seeked. Animated frames are therefore sampled from
 * an attached, paused SVG tree, frozen into a clone, then rasterized through <img>.
 */
export class SvgRenderer {
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private img: HTMLImageElement | null = null;
  private width: number;
  private height: number;
  private animated: boolean;
  private svgString: string | null = null;
  private liveHost: HTMLDivElement | null = null;
  private liveSvg: SVGSVGElement | null = null;
  private liveTime = 0;
  private observedAnimationTime: number | undefined;
  private cssAnimations: Animation[] = [];
  private duration: number;

  constructor(width: number, height: number, animated = false) {
    this.width = width;
    this.height = height;
    this.animated = animated;
    this.duration = 1 / 30;
    this.observedAnimationTime = undefined;

    const container = document.createElement('div');

    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.style.overflow = 'hidden';
    // Keep alpha transparent on both capture canvases.
    container.style.backgroundColor = 'transparent';
    document.body.appendChild(container);

    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;
    container.appendChild(canvas);

    this.container = container;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  async load(svgString: string, durationOverride?: number): Promise<void> {
    this.destroyImg();
    this.destroyLiveSvg();
    this.observedAnimationTime = undefined;

    const inlined = await inlineSvgImages(svgString, 10000);

    if (!this.animated) {
      this.svgString = inlined;
      await this.loadAsImg(inlined);

      return;
    }

    // SMIL animVal advances only while the SVG is attached to the document.
    this.svgString = namespaceSvgIdsForPlayback(
      inlined,
      `__svg_frame_${++svgPlaybackNamespaceSequence}_`,
    );
    await this.mountLiveSvg();
    const nativeDuration = parseSvgAnimationDuration(inlined);
    const cssDuration = measureLiveAnimationWindow(this.liveSvg);

    // Ignore non-finite durations when choosing the sampling window.
    const merged = Math.max(
      nativeDuration,
      cssDuration,
      durationOverride != null && durationOverride > 0 ? durationOverride : 0,
    );

    this.duration = Number.isFinite(merged) && merged > 0 ? merged : 1 / 30;
    await this.gotoTimeAsync(0);
  }

  /** Animated callers must await gotoTimeAsync before reading a snapshot. */
  gotoTime(seconds: number): void {
    if (!this.ctx) { return; }
    if (!this.animated || this.liveSvg == null) {
      this.redrawImg();

      return;
    }
    void this.gotoTimeAsync(seconds);
  }

  async gotoTimeAsync(seconds: number): Promise<void> {
    if (!this.animated || this.liveSvg == null) {
      this.redrawImg();

      return;
    }
    const snapshot = await this.bakeSnapshotAt(seconds);

    await this.loadSnapshotAsync(snapshot);
    this.redrawImg();
    await waitForFrames(1);
  }

  private async bakeSnapshotAt(seconds: number): Promise<string> {
    const targetTime = Math.max(0, seconds);

    if (targetTime < this.liveTime - 1e-9) {
      // SMIL syncbase timing schedules event instances. Rewinding the clock alone keeps
      // instances from later times, so replay must start from a fresh SVG tree.
      this.destroyLiveSvg();
      await this.mountLiveSvg();
    }
    const svgEl = this.liveSvg;

    if (svgEl == null) { return this.svgString ?? ''; }
    for (const time of getSmilReplayTimes(this.liveTime, targetTime)) {
      try {
        svgEl.setCurrentTime(time);
      } catch { /* 旧浏览器无 setCurrentTime,退 baseVal(静态) */ }
    }
    this.liveTime = targetTime;
    this.seekCssAnimations(targetTime);

    // Wait for layout before reading animated style and CTM.
    await waitForFrames(1);
    try {
      const observed = svgEl.getCurrentTime();

      this.observedAnimationTime = Number.isFinite(observed) ? observed : undefined;
    } catch {
      this.observedAnimationTime = undefined;
    }
    const snapshot = svgEl.cloneNode(true) as SVGSVGElement;

    // Bake into a clone so one frame does not change the next frame’s underlying values.
    bakeAnimVals(svgEl, snapshot);
    bakeCssAnimationState(svgEl, snapshot);
    snapshot.querySelectorAll('animate,animateTransform,animateMotion,set').forEach(el => el.remove());
    const xml = new XMLSerializer().serializeToString(snapshot);

    return xml;
  }

  private async loadSnapshotAsync(snapshotSvg: string): Promise<void> {
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(snapshotSvg)));

    await this.loadAsImg(dataUrl);
  }

  private redrawImg(): void {
    if (!this.ctx || !this.img) { return; }
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(this.img, 0, 0, this.width, this.height);
  }

  toDataUrl(): string {
    return this.canvas.toDataURL('image/png');
  }

  getDuration(): number {
    return this.duration;
  }

  /** Browser-reported SMIL clock after the latest seek. */
  getObservedAnimationTime(): number | undefined {
    return this.observedAnimationTime;
  }

  dispose(): void {
    this.destroyImg();
    this.destroyLiveSvg();
    this.container.remove();
  }

  private destroyImg(): void {
    if (this.img) {
      this.img.src = '';
      this.img = null;
    }
  }

  private destroyLiveSvg(): void {
    this.liveHost?.remove();
    this.liveHost = null;
    this.liveSvg = null;
    this.liveTime = 0;
    this.observedAnimationTime = undefined;
    this.cssAnimations = [];
  }

  private async mountLiveSvg(): Promise<void> {
    const liveHost = document.createElement('div');

    liveHost.style.position = 'absolute';
    liveHost.style.left = '0';
    liveHost.style.top = '0';
    liveHost.style.width = `${this.width}px`;
    liveHost.style.height = `${this.height}px`;
    liveHost.style.pointerEvents = 'none';
    // A tree created while detached can bind syncbase events to the document clock.
    // Attach the empty host first so the new SVG timeline starts at zero.
    this.container.insertBefore(liveHost, this.canvas);
    const liveSvg = mountSvgIntoHost(liveHost, this.svgString ?? '');

    if (liveSvg == null) {
      liveHost.remove();
      throw new Error('动态 SVG 缺少 <svg> 根节点');
    }
    this.liveHost = liveHost;
    this.liveSvg = liveSvg;
    this.liveTime = 0;
    try { liveSvg.pauseAnimations(); } catch { /* old browser */ }
    this.cssAnimations = collectCssAnimations(liveSvg);
    for (const animation of this.cssAnimations) {
      try { animation.pause(); } catch { /* 只读时间线,忽略 */ }
    }
    await waitForFrames(2);
  }

  /** CSS timelines use milliseconds and are independent of the SMIL clock. */
  private seekCssAnimations(seconds: number): void {
    for (const animation of this.cssAnimations) {
      try {
        animation.currentTime = seconds * 1000;
      } catch { /* 时间线不可写时保持原相位 */ }
    }
  }

  /** Wait for image decoding and paint before exposing the snapshot. */
  private loadAsImg(src: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      // Use Base64 to encode Unicode SVG source.
      const dataUrl = src.startsWith('data:')
        ? src
        : 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(src)));

      img.onload = () => {
        this.img = img;
        this.redrawImg();
        void waitForFrames(3).then(() => resolve());
      };
      img.onerror = () => reject(new Error('SVG 图片加载失败'));
      img.src = dataUrl;
    });
  }
}

/** Freeze animated attributes, transforms and motion into a clone without changing the live tree. */
function bakeAnimVals(sourceRoot: SVGSVGElement, targetRoot: SVGSVGElement): void {
  const sourceElements = [sourceRoot as Element, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const targetElements = [targetRoot as Element, ...Array.from(targetRoot.querySelectorAll('*'))];
  const cloneBySource = new Map<Element, Element>();

  sourceElements.forEach((source, index) => {
    const target = targetElements[index];

    if (target != null) { cloneBySource.set(source, target); }
  });

  const animates = sourceRoot.querySelectorAll('animate,set');

  for(const a of animates) {
    const attrName = a.getAttribute('attributeName');

    if (attrName == null) { continue; }
    const sourceTarget = resolveAnimationTarget(a, sourceRoot);
    const target = sourceTarget == null ? null : cloneBySource.get(sourceTarget);

    if (sourceTarget == null || target == null) { continue; }
    const val = readAnimVal(sourceTarget, attrName);

    if (val != null) {
      target.setAttribute(attrName, val);
      // Presentation attributes lose to author styles once SMIL is removed.
      if (target instanceof SVGElement) {
        const computed = getComputedStyle(sourceTarget).getPropertyValue(attrName).trim();

        if (computed !== '') { target.style.setProperty(attrName, computed, 'important'); }
      }
    }
  }
  const aTransforms = sourceRoot.querySelectorAll('animateTransform');

  for(const at of aTransforms) {
    const sourceTarget = resolveAnimationTarget(at, sourceRoot);
    const target = sourceTarget == null ? null : cloneBySource.get(sourceTarget);

    if (sourceTarget == null || target == null) { continue; }
    const tl = (sourceTarget as unknown as SVGGraphicsElement).transform?.animVal;

    if (tl == null || tl.numberOfItems === 0) { continue; }
    // Combine additive transform entries before writing the snapshot.
    let combined: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;

    for (let i = 0; i < tl.numberOfItems; i++) {
      const m = tl.getItem(i).matrix;

      combined = combined == null ? { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }
        : multiplyMatrix(combined, { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });
    }
    if (combined != null) {
      target.setAttribute(
        'transform',
        `matrix(${combined.a} ${combined.b} ${combined.c} ${combined.d} ${combined.e} ${combined.f})`,
      );
    }
  }
  // Motion is absent from transform.animVal; remove the parent CTM to get the local transform.
  for(const motion of sourceRoot.querySelectorAll('animateMotion')) {
    const sourceTarget = resolveAnimationTarget(motion, sourceRoot) as SVGGraphicsElement | null;
    const target = sourceTarget == null ? null : cloneBySource.get(sourceTarget);
    const ctm = sourceTarget?.getCTM();
    const parentCtm = (sourceTarget?.parentElement as SVGGraphicsElement | null)?.getCTM?.();

    if (target == null || ctm == null || parentCtm == null) { continue; }
    const local = relativeMatrix(parentCtm, ctm);

    target.setAttribute('transform', `matrix(${local.a} ${local.b} ${local.c} ${local.d} ${local.e} ${local.f})`);
  }
}

/**
 * XML preserves embedded metadata without breaking out of the SVG namespace, as the
 * HTML parser can do for nested HTML tags. Supply missing namespaces first; malformed
 * XML falls back to HTML parsing.
 */
function mountSvgIntoHost(host: HTMLElement, svgString: string): SVGSVGElement | null {
  const xmlDoc = parseSvgAsXml(svgString);

  if(xmlDoc != null) {
    const imported = document.importNode(xmlDoc.documentElement, true);

    if (!(imported instanceof SVGSVGElement)) { return null; }
    host.appendChild(imported);

    return imported;
  }
  host.innerHTML = svgString;

  return host.querySelector('svg');
}

function parseSvgAsXml(svgString: string): XMLDocument | null {
  const repaired = declareSvgNamespaces(svgString);
  const doc = new DOMParser().parseFromString(repaired, 'image/svg+xml');

  if(doc.querySelector('parsererror') != null) { return null; }
  if(doc.documentElement.tagName.toLowerCase() !== 'svg') { return null; }

  return doc;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

/** Supply missing SVG and xlink namespaces before XML parsing. */
export function declareSvgNamespaces(svgString: string): string {
  const openingTag = svgString.match(/<svg\b[^>]*>/i)?.[0];

  if(openingTag == null) { return svgString; }
  const additions: string[] = [];

  if(!/\bxmlns\s*=/i.test(openingTag)) { additions.push(`xmlns="${SVG_NAMESPACE}"`); }
  if(!/\bxmlns:xlink\s*=/i.test(openingTag) && /\bxlink:[\w-]+\s*=/i.test(svgString)) {
    additions.push(`xmlns:xlink="${XLINK_NAMESPACE}"`);
  }
  if(additions.length === 0) { return svgString; }
  const patchedTag = openingTag.replace(/^<svg\b/i, `<svg ${additions.join(' ')}`);

  return svgString.replace(openingTag, patchedTag);
}

function collectCssAnimations(root: SVGSVGElement): Animation[] {
  if(typeof root.getAnimations !== 'function') { return []; }

  return root.getAnimations({ subtree: true });
}

/** Measure the longest CSS animation; infinite iterations use one cycle. */
function measureLiveAnimationWindow(root: SVGSVGElement | null): number {
  if(root == null) { return 0; }
  let longest = 0;

  for(const animation of collectCssAnimations(root)) {
    const seconds = measureAnimationWindowSeconds(animation);

    if (seconds > longest) { longest = seconds; }
  }

  return longest;
}

function measureAnimationWindowSeconds(animation: Animation): number {
  try {
    const timing = animation.effect?.getComputedTiming();

    if (timing == null) { return 0; }
    const endTime = timing.endTime;

    if (typeof endTime === 'number' && Number.isFinite(endTime)) { return Math.max(0, endTime / 1000); }
    // Negative delay offsets the phase; it does not extend the sampling window.
    const duration = typeof timing.duration === 'number' ? timing.duration : 0;
    const delay = typeof timing.delay === 'number' ? Math.max(0, timing.delay) : 0;

    return Number.isFinite(duration) && duration > 0 ? (delay + duration) / 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * CSS animation values are exposed through computed style, not SMIL animVal.
 * Freeze those values as inline styles and disable animations so the snapshot does
 * not restart them when loaded through <img>.
 */
function bakeCssAnimationState(sourceRoot: SVGSVGElement, targetRoot: SVGSVGElement): void {
  if(typeof sourceRoot.getAnimations !== 'function') { return; }
  const animated = sourceRoot.getAnimations({ subtree: true });

  if(animated.length === 0) { return; }
  const targets = new Set<Element>();

  for(const animation of animated) {
    const effect = animation.effect;

    if (!(effect instanceof KeyframeEffect)) { continue; }
    const animationTarget = effect.target;

    if (animationTarget != null) { targets.add(animationTarget); }
  }
  const sourceElements = [sourceRoot as Element, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const targetElements = [targetRoot as Element, ...Array.from(targetRoot.querySelectorAll('*'))];

  sourceElements.forEach((source, index) => {
    if (!targets.has(source)) { return; }
    const target = targetElements[index] as (Element & { style?: CSSStyleDeclaration }) | undefined;

    if (target?.style == null) { return; }
    for (const property of collectAnimatedCssProperties(source)) {
      const value = getComputedStyle(source).getPropertyValue(property).trim();

      if (value !== '') { target.style.setProperty(property, value); }
    }
    target.style.setProperty('animation', 'none');
  });
}

/** Animated CSS property names for one element, in animation-declaration order. */
function collectAnimatedCssProperties(element: Element): string[] {
  const properties = new Set<string>();

  for(const animation of element.getAnimations?.() ?? []) {
    const effect = animation.effect;

    if (!(effect instanceof KeyframeEffect)) { continue; }
    for (const keyframe of effect.getKeyframes()) {
      for (const name of Object.keys(keyframe)) {
        if (name === 'offset' || name === 'computedOffset' || name === 'easing' || name === 'composite') { continue; }
        properties.add(name);
      }
    }
  }

  return [...properties];
}

function resolveAnimationTarget(animation: Element, root: SVGSVGElement): Element | null {
  const href = animation.getAttribute('href') ?? animation.getAttribute('xlink:href');

  if(href?.startsWith('#')) {
    const id = href.slice(1);

    return Array.from(root.querySelectorAll('[id]')).find(candidate => candidate.getAttribute('id') === id) ?? null;
  }

  return animation.parentElement;
}

/** Read animated geometry values or computed presentation properties. */
function readAnimVal(el: Element, attr: string): string | null {
  const gfx = el as SVGGraphicsElement & Record<string, unknown>;
  const prop = gfx[attr] as { animVal?: { value?: number } } | undefined;

  if(prop != null && prop.animVal != null && typeof prop.animVal.value === 'number') {
    return String(prop.animVal.value);
  }
  const numProp = gfx[attr] as { animVal?: { value?: number } } | undefined;

  if(numProp != null && numProp.animVal != null && typeof numProp.animVal.value === 'number') {
    return String(numProp.animVal.value);
  }

  if(attr === 'points') {
    const points = (el as unknown as { animatedPoints?: SVGPointList }).animatedPoints;

    if (points != null && points.numberOfItems > 0) {
      const values: string[] = [];

      for (let i = 0; i < points.numberOfItems; i++) {
        const point = points.getItem(i);

        values.push(`${point.x},${point.y}`);
      }

      return values.join(' ');
    }
  }

  // Presentation attributes expose their animated values through computed style.
  const computed = getComputedStyle(el).getPropertyValue(attr).trim();

  if(computed !== '') {
    if (attr === 'd') {
      const path = computed.match(/^path\(["'](.*)["']\)$/);

      return path?.[1] ?? null;
    }

    return computed;
  }

  return null;
}

export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function invertMatrix(m: AffineMatrix): AffineMatrix {
  const determinant = m.a * m.d - m.b * m.c;

  if(Math.abs(determinant) < 1e-12) { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  const scale = 1 / determinant;

  return {
    a: m.d * scale,
    b: -m.b * scale,
    c: -m.c * scale,
    d: m.a * scale,
    e: (m.c * m.f - m.d * m.e) * scale,
    f: (m.b * m.e - m.a * m.f) * scale,
  };
}

function multiplyMatrix(m1: AffineMatrix, m2: AffineMatrix): AffineMatrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

/** Remove parent transforms, including viewBox scaling, before writing the local snapshot transform. */
export function relativeMatrix(parentCtm: AffineMatrix, elementCtm: AffineMatrix): AffineMatrix {
  return multiplyMatrix(invertMatrix(parentCtm), elementCtm);
}

/**
 * Coarse seeks can miss SMIL syncbase events, so replay in monotonic steps.
 * Cap the count and widen the step for long timelines to bound memory and seek cost.
 */
export const MAX_SMIL_REPLAY_STEPS = 4096;

export function getSmilReplayTimes(from: number, to: number, maxStep = 1 / 60): number[] {
  if(!Number.isFinite(from) || !Number.isFinite(to) || to <= from + 1e-9) { return [to]; }
  const stepCount = Math.min(MAX_SMIL_REPLAY_STEPS, Math.max(1, Math.ceil((to - from) / maxStep)));

  return Array.from({ length: stepCount }, (_, index) => (
    index === stepCount - 1 ? to : from + (to - from) * (index + 1) / stepCount
  ));
}

export function readRootSvgAttribute(
  openingTag: string, name: 'width' | 'height' | 'viewBox',
): string | undefined {
  const match = openingTag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));

  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function parseConcreteSvgLength(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(?:px)?$/i);
  const number = match == null ? NaN : Number(match[1]);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Read the authored raster viewport used by the native SVG capture path. */
export function readSvgIntrinsicSize(svgString: string): { width: number; height: number } | undefined {
  const openingTag = svgString.match(/<svg\b[^>]*>/i)?.[0];

  if(openingTag == null) { return undefined; }
  const width = parseConcreteSvgLength(readRootSvgAttribute(openingTag, 'width'));
  const height = parseConcreteSvgLength(readRootSvgAttribute(openingTag, 'height'));

  if(width == null || height == null) { return undefined; }

  return { width, height };
}

/**
 * Duplicate IDs can bind syncbase events to another SVG tree on the page.
 * Rename IDs together with timing, href, paint-server and stylesheet references.
 */
export function namespaceSvgIdsForPlayback(svgString: string, prefix: string): string {
  const idMap = new Map<string, string>();

  for(const match of svgString.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)) {
    const id = match[2];

    if (id !== '') { idMap.set(id, `${prefix}${id}`); }
  }
  if(idMap.size === 0) { return svgString; }

  const attributePattern = /\b([\w:-]+)\s*=\s*(["'])(.*?)\2/g;
  const namespaced = svgString.replace(attributePattern, (attribute, name: string, quote: string, rawValue: string) => {
    const lowerName = name.toLowerCase();
    let value = rawValue;

    if (lowerName === 'id') {
      value = idMap.get(value) ?? value;
    } else {
      if ((lowerName === 'href' || lowerName === 'xlink:href') && value.startsWith('#')) {
        const mapped = idMap.get(value.slice(1));

        if (mapped != null) { value = `#${mapped}`; }
      }
      value = namespaceSvgStyleUrls(value, idMap);
      if (lowerName === 'begin' || lowerName === 'end') {
        const timingPattern = /(^|;)\s*([^\s;.]+)\.(begin|end|repeat(?:\(\s*\d+\s*\))?)/gi;

        value = value.replace(timingPattern, (match, separator: string, id: string, event: string) => {
          const mapped = idMap.get(id);

          return mapped == null ? match : `${separator}${mapped}.${event}`;
        });
      }
    }

    return `${name}=${quote}${value}${quote}`;
  });

  return namespaceSvgStyles(namespaced, idMap);
}

/** Use the longest SMIL interval; unbounded repeats use one cycle and static SVG uses 1/30 second. */
export function parseSvgAnimationDuration(svgString: string): number {
  const tagRe = /<(animate|animateTransform|animateMotion|set)\b[^>]*>/gi;
  let maxEnd = 0;
  let hasAny = false;
  let m: RegExpExecArray | null;

  while((m = tagRe.exec(svgString)) !== null) {
    const tag = m[0];

    hasAny = true;
    const dur = parseFloat((tag.match(/\bdur=["']?([\d.]+)(s|ms)?/i) || [])[1] ?? '0') || 0;
    const durS = (tag.match(/\bdur=["']?[\d.]+ms/i)) ? dur / 1000 : dur;
    const begin = parseFloat((tag.match(/\bbegin=["']?([\d.]+)(s|ms)?/i) || [])[1] ?? '0') || 0;
    const beginS = (tag.match(/\bbegin=["']?[\d.]+ms/i)) ? begin / 1000 : begin;
    const repeat = (tag.match(/\brepeatCount=["']?(indefinite|\d+)/i) || [])[1];
    const cycles = repeat === 'indefinite' ? 1 : (repeat != null ? finiteCycleCount(Number(repeat)) : 1);
    const end = beginS + durS * cycles;

    if (Number.isFinite(end) && end > maxEnd) { maxEnd = end; }
  }

  return hasAny && maxEnd > 0 ? maxEnd : 1 / 30;
}

/** Non-finite repeat counts use one cycle. */
function finiteCycleCount(count: number): number {
  return Number.isFinite(count) && count > 0 ? count : 1;
}

function waitForFrames(frames: number): Promise<void> {
  return new Promise(resolve => {
    let remaining = frames;

    const tick = () => {
      if (--remaining <= 0) {
        resolve();
      } else {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  });
}

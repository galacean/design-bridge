/**
 * SMIL begin/end、repeat 和 syncbase 时间调度。
 *
 * 本模块不负责动画值插值，只负责确定动画何时开始、结束以及哪些 interval 需要展开。
 */
import {
  BEGIN_TIME_EPSILON, EPSILON, MAX_SYNCBASE_EVENTS,
  type BeginTimeCache, type SyncbaseDependency,
} from './types';

export function parseClockValue (raw: string): number | null {
  const value = raw.trim();

  if (value === '') { return 0; }
  const clock = value.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);

  if (clock != null) {
    return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }
  const scalar = value.match(/^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(ms|s|min|h)?$/i);

  if (scalar == null) { return null; }
  const number = Number(scalar[1]);
  const unit = scalar[2]?.toLowerCase() ?? 's';

  if (unit === 'ms') { return number / 1000; }
  if (unit === 'min') { return number * 60; }
  if (unit === 'h') { return number * 3600; }

  return number;
}

export function activeDuration (tag: globalThis.Element): number {
  const duration = parseClockValue(tag.getAttribute('dur') ?? '') ?? 0;

  if (duration <= 0) { return 0; }
  const repeatRaw = (tag.getAttribute('repeatCount') ?? '').trim().toLowerCase();
  const repeatDurationRaw = tag.getAttribute('repeatDur');
  const repeatDuration = repeatDurationRaw == null ? null : parseClockValue(repeatDurationRaw);
  let repeated = duration;

  if (repeatRaw === 'indefinite') {
    // 对无界动画取一个完整周期；存在 repeatDur 时使用它作为有限边界。
    repeated = repeatDuration != null && repeatDuration > 0 ? repeatDuration : duration;
  } else if (repeatRaw !== '') {
    const count = Number(repeatRaw);

    repeated = Number.isFinite(count) && count >= 0 ? duration * count : duration;
  } else if (repeatDuration != null) {
    // repeatDur 可以单独定义 active duration，不要求同时存在 repeatCount。
    // Chrome 会重复 simple duration，直到达到该边界。
    repeated = repeatDuration;
  }
  if (repeatDuration != null) {
    repeated = Math.min(repeated, repeatDuration);
  }

  return repeated;
}

export function findAnimationById (root: globalThis.Element, id: string): globalThis.Element | null {
  for (const candidate of Array.from(root.querySelectorAll('[id]'))) {
    if (candidate.getAttribute('id') === id) { return candidate; }
  }

  return null;
}

function animationTags (root: globalThis.Element): globalThis.Element[] {
  return Array.from(root.querySelectorAll('animate,animateColor,animateTransform,animateMotion,set'));
}

const initialBeginTimeCaches = new WeakMap<object, BeginTimeCache>();
const windowedBeginTimeCaches = new WeakMap<object, Map<number, BeginTimeCache>>();

export function getBeginTimeCache (root: globalThis.Element, comparisonDuration?: number): BeginTimeCache {
  if (comparisonDuration == null || comparisonDuration <= 0) {
    const cached = initialBeginTimeCaches.get(root);

    if (cached != null) { return cached; }
    const cache: BeginTimeCache = new Map();

    initialBeginTimeCaches.set(root, cache);

    return cache;
  }
  let caches = windowedBeginTimeCaches.get(root);

  if (caches == null) {
    caches = new Map();
    windowedBeginTimeCaches.set(root, caches);
  }
  const cached = caches.get(comparisonDuration);

  if (cached != null) { return cached; }
  const cache: BeginTimeCache = new Map();

  caches.set(comparisonDuration, cache);

  return cache;
}

function parseBeginSpecifiers (
  tag: globalThis.Element,
  root: globalThis.Element,
): { absolute: number[]; dependencies: SyncbaseDependency[] } {
  const absolute: number[] = [];
  const dependencies: SyncbaseDependency[] = [];

  for (const candidateRaw of (tag.getAttribute('begin') ?? '0').split(';')) {
    const candidate = candidateRaw.trim();
    const absoluteTime = parseClockValue(candidate);

    if (absoluteTime != null) {
      absolute.push(absoluteTime);
      continue;
    }
    const syncbase = candidate.match(/^(.+?)\.(begin|end)\s*([+-]\s*.+)?$/i);

    if (syncbase == null) { continue; }
    const source = findAnimationById(root, syncbase[1]);
    const offset = syncbase[3] == null ? 0 : parseClockValue(syncbase[3].replace(/\s+/g, ''));

    if (source == null || offset == null) { continue; }
    dependencies.push({
      source,
      target: tag,
      event: syncbase[2].toLowerCase() as 'begin' | 'end',
      offset,
    });
  }

  return { absolute, dependencies };
}

function addBeginTime (times: number[], time: number): boolean {
  if (!Number.isFinite(time) || times.some(candidate => Math.abs(candidate - time) < BEGIN_TIME_EPSILON)) {
    return false;
  }
  times.push(time);
  times.sort((a, b) => a - b);

  return true;
}

/**
 * 计算每个动画的初始 interval，用于确定 composition duration。
 */
function buildInitialBeginSchedule (root: globalThis.Element, cache: BeginTimeCache): void {
  const tags = animationTags(root);
  const specs = new Map(tags.map(tag => [tag, parseBeginSpecifiers(tag, root)]));

  for (const tag of tags) {
    const absolute = specs.get(tag)?.absolute ?? [];

    cache.set(tag, absolute.length > 0 ? [Math.min(...absolute)] : []);
  }

  for (let iteration = 0; iteration < Math.max(1, tags.length * 4); iteration++) {
    let changed = false;

    for (const tag of tags) {
      for (const dependency of specs.get(tag)?.dependencies ?? []) {
        const sourceBegin = cache.get(dependency.source)?.[0];

        if (sourceBegin == null) { continue; }
        const candidate = sourceBegin
          + (dependency.event === 'end' ? activeDuration(dependency.source) : 0)
          + dependency.offset;
        const current = cache.get(tag)?.[0];

        if (current == null || candidate < current - BEGIN_TIME_EPSILON) {
          cache.set(tag, [candidate]);
          changed = true;
        }
      }
    }
    if (!changed) { break; }
  }
}

/**
 * 在有限时间窗口内展开 begin/end syncbase 事件。
 */
function buildWindowedBeginSchedule (
  root: globalThis.Element,
  cache: BeginTimeCache,
  comparisonDuration: number,
): void {
  const tags = animationTags(root);
  const dependents = new Map<globalThis.Element, SyncbaseDependency[]>();
  const maxActiveDuration = tags.reduce((max, tag) => Math.max(max, activeDuration(tag)), 0);
  const lowerBound = -Math.max(1, comparisonDuration, maxActiveDuration);
  const queue: Array<{ tag: globalThis.Element; time: number }> = [];

  for (const tag of tags) {
    cache.set(tag, []);
    const specifiers = parseBeginSpecifiers(tag, root);

    for (const dependency of specifiers.dependencies) {
      const list = dependents.get(dependency.source) ?? [];

      list.push(dependency);
      dependents.set(dependency.source, list);
    }
    for (const time of specifiers.absolute) {
      if (time < lowerBound - BEGIN_TIME_EPSILON || time > comparisonDuration + BEGIN_TIME_EPSILON) { continue; }
      if (addBeginTime(cache.get(tag)!, time)) { queue.push({ tag, time }); }
    }
  }

  let cursor = 0;

  while (cursor < queue.length && queue.length < MAX_SYNCBASE_EVENTS) {
    const event = queue[cursor++];

    for (const dependency of dependents.get(event.tag) ?? []) {
      const candidate = event.time
        + (dependency.event === 'end' ? activeDuration(event.tag) : 0)
        + dependency.offset;

      if (candidate < lowerBound - BEGIN_TIME_EPSILON || candidate > comparisonDuration + BEGIN_TIME_EPSILON) {
        continue;
      }
      const targetTimes = cache.get(dependency.target);

      if (targetTimes != null && addBeginTime(targetTimes, candidate)) {
        queue.push({ tag: dependency.target, time: candidate });
      }
    }
  }
}

export function resolveBeginTimes (
  tag: globalThis.Element,
  root: globalThis.Element,
  cache: BeginTimeCache,
  comparisonDuration?: number,
): number[] {
  if (!cache.has(tag)) {
    if (comparisonDuration != null && comparisonDuration > 0) {
      buildWindowedBeginSchedule(root, cache, comparisonDuration);
    } else {
      buildInitialBeginSchedule(root, cache);
    }
  }

  return cache.get(tag) ?? [];
}

export function resolveBegin (
  tag: globalThis.Element,
  root: globalThis.Element,
  cache: BeginTimeCache,
): number | null {
  return resolveBeginTimes(tag, root, cache)[0] ?? null;
}
export function comparisonEnd (tag: globalThis.Element, begin: number): number {
  const duration = parseClockValue(tag.getAttribute('dur') ?? '') ?? 0;
  const indefinite = (tag.getAttribute('repeatCount') ?? '').trim().toLowerCase() === 'indefinite';
  const durationMissing = (tag.getAttribute('dur') ?? '').trim() === '';
  const singleValue = (tag.getAttribute('values') ?? '')
    .split(';')
    .filter(value => value.trim() !== '')
    .length === 1;

  if (durationMissing && (tag.tagName.toLowerCase() === 'set' || singleValue)) {
    return Math.max(0, begin);
  }
  if (duration <= 0) { return 0; }
  if (indefinite && tag.getAttribute('repeatDur') == null) {
    // 比较一个完整周期。负 begin 表示相位偏移，不应缩短比较窗口。
    return Math.max(duration, begin + duration, 0);
  }

  return Math.max(0, begin + activeDuration(tag));
}
export function buildAnimationWindows (
  tag: globalThis.Element,
  beginTimes: number[],
  totalDuration: number,
  comparisonDuration?: number,
): Array<{ begin: number; end: number }> {
  const restart = (tag.getAttribute('restart') ?? 'always').trim().toLowerCase();
  const indefinite = (tag.getAttribute('repeatCount') ?? '').trim().toLowerCase() === 'indefinite'
    && tag.getAttribute('repeatDur') == null;
  const acceptedBegins: number[] = [];
  let previousEnd = -Infinity;

  for (const begin of beginTimes.slice().sort((a, b) => a - b)) {
    if (restart === 'never' && acceptedBegins.length > 0) { break; }
    if (restart === 'whennotactive' && begin < previousEnd - EPSILON) { continue; }
    acceptedBegins.push(begin);
    previousEnd = indefinite && comparisonDuration != null ? comparisonDuration : begin + totalDuration;
  }

  const windows: Array<{ begin: number; end: number }> = [];
  const fill = (tag.getAttribute('fill') ?? '').trim().toLowerCase();

  for (let index = 0; index < acceptedBegins.length; index++) {
    const begin = acceptedBegins[index];
    const naturalEnd = indefinite && comparisonDuration != null
      ? comparisonDuration
      : begin + totalDuration;
    const restartedAt = restart === 'always' ? acceptedBegins[index + 1] : undefined;
    let end = restartedAt == null ? naturalEnd : Math.min(naturalEnd, restartedAt);

    if (comparisonDuration != null) { end = Math.min(end, comparisonDuration); }
    if (end <= 0 && fill !== 'freeze') { continue; }
    if (begin >= end - EPSILON && !(end === 0 && fill === 'freeze')) { continue; }

    windows.push({ begin, end });
  }

  return windows;
}

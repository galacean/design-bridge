/** SVG SMIL 动画解析入口。 */
import { activeDuration, buildAnimationWindows, parseClockValue, resolveBeginTimes } from './timeline-schedule';
import { clipSamplesToComparisonWindow, expandSamples, parseKeySplines, parsePacedKeyTimes, parseValue, parseValues } from './timeline-values';
import type { BeginTimeCache, SMILAnimation, SMILInterval, SMILSample, SMILValueParser } from './types';

export {
  cubicBezierRatio,
  interpolateValues,
  parseColorValue,
  parseNumberList,
  parsePointValue,
  parseKeySplines,
  parseValue,
  sampleExpandedValue,
  splitCubicAtRatio,
  valuesEqual,
} from './timeline-values';
export {
  activeDuration,
  comparisonEnd,
  findAnimationById,
  parseClockValue,
  resolveBegin,
  resolveBeginTimes,
} from './timeline-schedule';

function parseSetValues (
  tag: globalThis.Element,
  type: string,
  valueParser: SMILValueParser,
): number[][] {
  const to = tag.getAttribute('to');

  if (to == null) { return []; }
  const value = valueParser(to, type);

  return value == null ? [] : [value, value];
}

export function parseSMILTag (
  tag: globalThis.Element,
  root: globalThis.Element,
  beginCache: BeginTimeCache,
  comparisonDuration?: number,
  valueParser: SMILValueParser = parseValue,
  underlyingValue?: number[],
): SMILAnimation | null {
  const tagName = tag.tagName.toLowerCase();
  const transformType = (tag.getAttribute('type') ?? '').toLowerCase();
  const attributeName = (tag.getAttribute('attributeName') ?? '').toLowerCase();
  const type = tagName === 'animatetransform' ? transformType : attributeName;
  const rawDuration = tag.getAttribute('dur');
  const durationMissing = rawDuration == null || rawDuration.trim() === '';
  const parsedDuration = parseClockValue(rawDuration ?? '') ?? 0;

  if (type === '') { return null; }
  const values = tagName === 'set'
    ? parseSetValues(tag, type, valueParser)
    : parseValues(tag, type, valueParser, underlyingValue);
  const singleValue = tagName !== 'set' && values.length === 1;
  const noDurationEvent = (tagName === 'set' || singleValue) && durationMissing;
  const byOnly = tag.getAttribute('by') != null
    && tag.getAttribute('values') == null
    && tag.getAttribute('from') == null
    && tag.getAttribute('to') == null;
  const explicitAdditive = (tag.getAttribute('additive') ?? '').trim().toLowerCase();
  const additive = explicitAdditive === 'sum' || (byOnly && explicitAdditive !== 'replace') ? 'sum' : 'replace';
  const animationValues = singleValue ? [values[0], values[0]] : values;
  const duration = noDurationEvent ? 1 : parsedDuration;
  const totalDuration = noDurationEvent ? 0 : activeDuration(tag);

  if ((!noDurationEvent && (duration <= 0 || totalDuration <= 0)) || animationValues.length < 2) { return null; }
  const calcModeRaw = (tag.getAttribute('calcMode') ?? 'linear').toLowerCase();
  const isDiscreteAttribute = type === 'display' || type === 'visibility';
  let calcMode: SMILAnimation['calcMode'];

  if (tagName === 'set' || isDiscreteAttribute) {
    calcMode = 'discrete';
  } else if (singleValue) {
    calcMode = 'linear';
  } else {
    calcMode = (['linear', 'discrete', 'spline', 'paced'].includes(calcModeRaw)
      ? calcModeRaw
      : 'linear') as SMILAnimation['calcMode'];
  }
  const keyTimesRaw = tag.getAttribute('keyTimes');
  let keyTimes: number[];

  if (tagName === 'set' || singleValue) {
    keyTimes = [0, 1];
  } else if (calcMode === 'paced') {
    keyTimes = parsePacedKeyTimes(animationValues);
  } else if (keyTimesRaw == null) {
    // SMIL discrete 模式未指定 keyTimes 时，将 simple duration 均分为 N 个 value 槽位；
    // 插值模式把首尾 value 放在 0 和 1。
    keyTimes = animationValues.map((_, index) => calcMode === 'discrete'
      ? index / animationValues.length
      : index / (animationValues.length - 1));
  } else {
    keyTimes = keyTimesRaw.split(';').map(Number);
  }

  if (keyTimes.length !== animationValues.length || keyTimes.some(time => !Number.isFinite(time))) {
    keyTimes = animationValues.map((_, index) => index / (animationValues.length - 1));
  }
  const beginTimes = resolveBeginTimes(tag, root, beginCache, comparisonDuration);

  if (beginTimes.length === 0) { return null; }
  const indefinite = noDurationEvent || (tag.getAttribute('repeatCount') ?? '').trim().toLowerCase() === 'indefinite';
  const fill = noDurationEvent || (tag.getAttribute('fill') ?? '').trim().toLowerCase() === 'freeze'
    ? 'freeze'
    : 'remove';
  const keySplines = parseKeySplines(tag, animationValues.length - 1);
  const samples: SMILSample[] = [];
  const intervals: SMILInterval[] = [];
  let cycleOffset = 0;

  if (noDurationEvent) {
    for (const begin of beginTimes) {
      const intervalBegin = Math.max(0, begin);
      const intervalEnd = comparisonDuration == null ? intervalBegin : Math.max(intervalBegin, comparisonDuration);
      const sampleStart = samples.length;

      samples.push({ time: intervalBegin, value: animationValues[0], cycle: 0, sourceIndex: 0 });
      intervals.push({
        begin: intervalBegin,
        end: intervalEnd,
        sampleStart,
        sampleEnd: samples.length,
      });
    }
  } else {
    const windows = buildAnimationWindows(tag, beginTimes, totalDuration, comparisonDuration);

    for (const window of windows) {
      const expanded = expandSamples(
        animationValues,
        keyTimes,
        window.begin,
        duration,
        Math.max(0, window.end - window.begin),
        (tag.getAttribute('accumulate') ?? '').toLowerCase() === 'sum',
        calcMode,
        keySplines,
      ).map(sample => ({ ...sample, cycle: sample.cycle + cycleOffset }));
      const clipped = clipSamplesToComparisonWindow(expanded, window.end, calcMode, keySplines, fill);
      const sampleStart = samples.length;

      samples.push(...clipped);
      intervals.push({
        begin: Math.max(0, window.begin),
        end: Math.max(0, window.end),
        sampleStart,
        sampleEnd: samples.length,
      });
      cycleOffset += Math.max(1, ...expanded.map(sample => sample.cycle - cycleOffset + 1));
    }
  }

  if (samples.length === 0 || intervals.length === 0) { return null; }
  const begin = Math.min(...intervals.map(interval => interval.begin));
  const end = Math.max(...intervals.map(interval => interval.end));

  return {
    attributeName,
    type,
    begin,
    end,
    fill,
    additive,
    byOnly,
    indefinite,
    calcMode,
    keySplines,
    samples,
    intervals,
  };
}

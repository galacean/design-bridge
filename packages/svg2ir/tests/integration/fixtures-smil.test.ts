import { describe, expect, it, vi } from 'vitest';
import type { IRAnimatedProperty, IRKeyframe, IRVec3 } from '@galacean/animation-ir';
import { convertSVGToIR, splitSVG } from '@galacean/svg2ir';

type Keyframed<T extends number | IRVec3> = Extract<IRAnimatedProperty<T>, { type: 'keyframed' }>;

function firstLayerTransform (svg: string) {
  return convertSVGToIR(svg).ir.compositions[0].layers[0].transform!;
}

describe('fixture: SMIL animation', () => {
  it('uses viewBox dimensions when root width and height are percentages', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 480 360">
        <rect width="480" height="360">
          <animate attributeName="opacity" values="1;0" dur="1s"/>
        </rect>
      </svg>
    `);

    expect(result.ir.compositions[0].width).toBe(480);
    expect(result.ir.compositions[0].height).toBe(360);
  });

  it('animateTransform honors replace vs additive transform composition', async () => {
    const replace = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <circle cx="25" cy="50" r="15" transform="translate(10 20)">
          <animateTransform attributeName="transform" type="translate" from="0 0" to="50 0" dur="2s" fill="freeze"/>
        </circle>
      </svg>
    `);
    const replacePosition = replace.position as Keyframed<IRVec3>;

    expect(replacePosition.type === 'keyframed').toBe(true);
    expect(replacePosition.keyframes).toEqual([
      { frame: 0, value: [25, 50, 0] },
      { frame: 60, value: [75, 50, 0] },
    ]);

    const additive = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <circle cx="25" cy="50" r="15" transform="translate(10 20)">
          <animateTransform attributeName="transform" type="translate" from="0 0" to="50 0" dur="2s" additive="sum" fill="freeze"/>
        </circle>
      </svg>
    `);
    const additivePosition = additive.position as Keyframed<IRVec3>;

    expect(additivePosition.keyframes).toEqual([
      { frame: 0, value: [35, 70, 0] },
      { frame: 60, value: [85, 70, 0] },
    ]);
  });

  it('does not report mapped transform animation elements as dropped', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <circle cx="25" cy="50" r="15">
          <animateTransform attributeName="transform" type="rotate" from="0" to="90" dur="1s" fill="freeze"/>
          <animateMotion path="M0 0 L10 0" dur="1s" fill="freeze"/>
        </circle>
      </svg>
    `);

    expect(result.warnings.some(w => w.message.includes('<animatetransform>'))).toBe(false);
    expect(result.warnings.some(w => w.message.includes('<animatemotion>'))).toBe(false);
  });

  it('does not report supported animate attributes as dropped', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <g>
          <animate id="group-opacity" attributeName="opacity" values="1;0.5" dur="1s"/>
          <rect x="10" y="10" width="20" height="20" fill="#f00" stroke="#fff">
            <animate id="rect-x" attributeName="x" values="10;20" dur="1s"/>
            <animate id="rect-width" attributeName="width" values="20;30" dur="1s"/>
            <animate id="rect-fill" attributeName="fill" values="#f00;#0f0" dur="1s"/>
            <animate id="rect-fill-opacity" attributeName="fill-opacity" values="1;0" dur="1s"/>
            <animate id="rect-stroke-opacity" attributeName="stroke-opacity" values="1;0" dur="1s"/>
            <animate id="rect-stroke-width" attributeName="stroke-width" values="1;3" dur="1s"/>
          </rect>
          <circle cx="70" cy="30" r="10">
            <animate id="circle-cx" attributeName="cx" values="70;80" dur="1s"/>
            <animate id="circle-r" attributeName="r" values="10;15" dur="1s"/>
          </circle>
        </g>
      </svg>
    `);

    expect(result.warnings.some(w => w.message.includes('<animate>'))).toBe(false);
  });

  it('maps display and visibility animation to discrete opacity tracks', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect id="display" width="20" height="20">
          <animate attributeName="display" to="none" dur="1s"/>
        </rect>
        <rect id="visibility" x="30" width="20" height="20">
          <animate attributeName="visibility" to="hidden" dur="1s"/>
        </rect>
      </svg>
    `);
    const opacityOf = (id: string) => result.ir.compositions[0].layers.find(layer => layer.name === id)!.transform!.opacity as Keyframed<number>;

    expect(opacityOf('display').keyframes.map(keyframe => ({ frame: keyframe.frame, value: keyframe.value }))).toEqual([
      { frame: 0, value: 1 },
      { frame: 14.999, value: 1 },
      { frame: 15, value: 0 },
      { frame: 29.999, value: 0 },
      { frame: 30, value: 1 },
    ]);
    expect(opacityOf('visibility').keyframes.map(keyframe => ({ frame: keyframe.frame, value: keyframe.value }))).toEqual([
      { frame: 0, value: 1 },
      { frame: 14.999, value: 1 },
      { frame: 15, value: 0 },
      { frame: 29.999, value: 0 },
      { frame: 30, value: 1 },
    ]);
    expect(result.warnings.some(warning => warning.message.includes('<animate>'))).toBe(false);
  });

  it('uses the underlying value for a to-only solid paint animation', async () => {
    const result = splitSVG(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect id="paint" width="20" height="20" fill="red">
          <animate attributeName="fill" to="green" dur="1s"/>
        </rect>
      </svg>
    `);
    const animations = result.preservedData.paintAnimationsByLayerId.get('0') ?? [];
    const colorAnimation = animations.find(animation => animation.kind === 'solid-color');

    expect(colorAnimation?.kind).toBe('solid-color');
    if (colorAnimation?.kind !== 'solid-color' || colorAnimation.color.type !== 'keyframed') {
      throw new Error('Expected a keyframed solid paint animation.');
    }
    expect(colorAnimation.color.keyframes[0].value).toEqual([1, 0, 0, 1]);
    expect(colorAnimation.color.keyframes.find(keyframe => keyframe.frame === 29.999)?.value).toEqual([0, 0.5019607843137255, 0, 1]);
    expect(colorAnimation.color.keyframes.at(-1)?.value).toEqual([1, 0, 0, 1]);
  });

  it('accumulates the final animated value across repeated geometry cycles', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect id="bar" x="10" y="20" width="10" height="20">
          <animate attributeName="height" from="200" to="20" calcMode="discrete"
            accumulate="sum" repeatCount="2" dur="4s" fill="freeze"/>
        </rect>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'bar')!;
    const scale = layer.transform!.scale as Keyframed<IRVec3>;
    const keyframeAt = (frame: number) => scale.keyframes.find(keyframe => Math.abs(keyframe.frame - frame) < 1e-6)?.value;

    expect(keyframeAt(0)).toEqual([1, 10, 1]);
    expect(keyframeAt(120)).toEqual([1, 11, 1]);
    expect(keyframeAt(120.25)).toEqual([1, 11, 1]);
    expect(keyframeAt(180)).toEqual([1, 2, 1]);
  });

  it('derives paced key times from value distances instead of authored keyTimes', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">
        <g transform="translate(150,140)">
          <rect id="bar" width="300" height="80">
            <animate attributeName="width" calcMode="paced" values="300;255;180;30"
              keyTimes="0;.25;.5;1" dur="9s" fill="freeze"/>
          </rect>
        </g>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'bar')!;
    const position = layer.transform!.position as Keyframed<IRVec3>;
    const scale = layer.transform!.scale as Keyframed<IRVec3>;
    const positionAt = (frame: number) => position.keyframes.find(keyframe => Math.abs(keyframe.frame - frame) < 1e-6)?.value;
    const scaleAt = (frame: number) => scale.keyframes.find(keyframe => Math.abs(keyframe.frame - frame) < 1e-6)?.value;

    expect(positionAt(45)).toEqual([277.5, 180, 0]);
    expect(scaleAt(45)).toEqual([0.85, 1, 1]);
    expect(positionAt(120)).toEqual([240, 180, 0]);
    expect(scaleAt(120)).toEqual([0.6, 1, 1]);
  });

  it('resolves href-targeted transform and paint animations', async () => {
    const transformResult = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100">
        <circle id="target" cx="10" cy="20" r="5"/>
        <animateTransform xlink:href="#target" attributeName="transform" type="translate"
          from="0 0" to="20 0" dur="1s" fill="freeze"/>
      </svg>
    `);
    const transform = transformResult.ir.compositions[0].layers[0].transform!;
    const position = transform.position as Keyframed<IRVec3>;

    expect(position.keyframes.map(keyframe => keyframe.value)).toEqual([[10, 20, 0], [30, 20, 0]]);
    expect(transformResult.warnings.some(warning => warning.message.includes('<animatetransform>'))).toBe(false);

    const paintResult = splitSVG(`
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100">
        <rect id="target" width="20" height="20" fill="red"/>
        <animate xlink:href="#target" attributeName="fill" values="red;green" dur="1s" fill="freeze"/>
      </svg>
    `);
    const animations = paintResult.preservedData.paintAnimationsByLayerId.get('0') ?? [];

    expect(animations.some(animation => animation.kind === 'solid-color')).toBe(true);
    expect(paintResult.warnings.some(warning => warning.message.includes('<animate>'))).toBe(false);
  });

  it('treats a by-only animation as a relative change from the underlying value', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect id="bar" x="10" y="20" width="10" height="10">
          <animate attributeName="x" by="20" dur="1s" fill="freeze"/>
        </rect>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'bar')!;
    const position = layer.transform!.position as Keyframed<IRVec3>;

    expect(position.keyframes[0].value).toEqual([15, 25, 0]);
    expect(position.keyframes.at(-1)?.value).toEqual([35, 25, 0]);
  });

  it('supports finite-duration set for opacity and geometry channels', async () => {
    const transform = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <rect x="10" y="10" width="20" height="20" fill="#f00">
          <set attributeName="opacity" to="0" begin="1s" dur="1s"/>
          <set attributeName="x" to="30" begin="1s" dur="1s"/>
        </rect>
      </svg>
    `);
    const opacity = transform.opacity as Keyframed<number>;
    const position = transform.position as Keyframed<IRVec3>;
    const keyframeAt = <T extends number | IRVec3> (keyframes: IRKeyframe<T>[], frame: number): IRKeyframe<T> => {
      const keyframe = keyframes.find(candidate => Math.abs(candidate.frame - frame) < 1e-6);

      if (keyframe == null) {
        throw new Error(`Missing keyframe at frame ${frame}`);
      }

      return keyframe;
    };

    expect(keyframeAt(opacity.keyframes, 0).value).toBe(1);
    expect(keyframeAt(opacity.keyframes, 30).value).toBe(0);
    expect(keyframeAt(opacity.keyframes, 60).value).toBe(1);
    expect(keyframeAt(position.keyframes, 0).value).toEqual([20, 20, 0]);
    expect(keyframeAt(position.keyframes, 30).value).toEqual([40, 20, 0]);
    expect(keyframeAt(position.keyframes, 60).value).toEqual([20, 20, 0]);

    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <rect width="20" height="20"><set attributeName="opacity" to="0" begin="1s" dur="1s"/></rect>
      </svg>
    `);

    expect(result.warnings.some(warning => warning.message.includes('<set>'))).toBe(false);
    expect(result.ir.compositions[0].outPoint).toBe(60);
  });

  it('still reports unsupported paint-server animation as dropped', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <linearGradient id="night"><stop offset="0" stop-color="#000"/></linearGradient>
          <linearGradient id="day"><stop offset="0" stop-color="#fff"/></linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#night)">
          <animate attributeName="fill" values="url(#night);url(#day)" dur="1s"/>
        </rect>
      </svg>
    `);

    expect(result.warnings.some(w => w.message.includes('<animate>'))).toBe(true);
  });

  it('still reports unsupported animateTransform types as dropped', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <circle cx="25" cy="50" r="15">
          <animateTransform attributeName="transform" type="skewX" from="0" to="20" dur="1s" fill="freeze"/>
        </circle>
      </svg>
    `);

    expect(result.warnings.some(w => w.message.includes('<animatetransform>'))).toBe(true);
  });

  it('animateTransform rotate/scale applies the full animated matrix to position and channels', async () => {
    const rotate = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <circle cx="25" cy="50" r="15">
          <animateTransform attributeName="transform" type="rotate" values="0 0 0;90 0 0" dur="1s" fill="freeze"/>
        </circle>
      </svg>
    `);
    const rotatePosition = rotate.position as Keyframed<IRVec3>;
    const rotation = rotate.rotation!.z as Keyframed<number>;

    expect(rotatePosition.keyframes[0].value).toEqual([25, 50, 0]);
    expect(rotatePosition.keyframes[1].value[0]).toBeCloseTo(-50, 6);
    expect(rotatePosition.keyframes[1].value[1]).toBeCloseTo(25, 6);
    expect(rotation.keyframes.map(kf => kf.value)).toEqual([0, 90]);
    expect(rotatePosition.keyframes[0].spatialOut).toBeDefined();
    expect(rotatePosition.keyframes[1].spatialIn).toBeDefined();

    const scale = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <circle cx="25" cy="50" r="15">
          <animateTransform attributeName="transform" type="scale" from="1" to="2" dur="1s" fill="freeze"/>
        </circle>
      </svg>
    `);
    const scalePosition = scale.position as Keyframed<IRVec3>;
    const scaleChannel = scale.scale as Keyframed<IRVec3>;

    expect(scalePosition.keyframes.map(kf => kf.value)).toEqual([[25, 50, 0], [50, 100, 0]]);
    expect(scaleChannel.keyframes.map(kf => kf.value)).toEqual([[1, 1, 1], [2, 2, 1]]);
  });

  it('does not reinterpret a translate distance as authored rotation', async () => {
    const transform = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <path d="M0 120 L100 20 L200 120 Z">
          <animateTransform attributeName="transform" type="translate" from="0,0" to="-1600,0" dur="20s" repeatCount="indefinite"/>
        </path>
      </svg>
    `);
    const rotation = transform.rotation!.z as Keyframed<number>;

    expect(rotation.keyframes.map(keyframe => keyframe.value)).toEqual([0, 0]);
  });

  it('keeps a full-turn rotation moving around its pivot', async () => {
    const transform = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
        <circle cx="50" cy="0" r="5">
          <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="1s" fill="freeze"/>
        </circle>
      </svg>
    `);
    const position = transform.position as Keyframed<IRVec3>;
    const rotation = transform.rotation!.z as Keyframed<number>;

    expect(position.keyframes.length).toBeGreaterThan(2);
    expect(position.keyframes.some(keyframe => Math.abs(keyframe.value[0]) < 1e-6 && Math.abs(keyframe.value[1] - 50) < 1e-6)).toBe(true);
    expect(position.keyframes.some(keyframe => Math.abs(keyframe.value[0] + 50) < 1e-6 && Math.abs(keyframe.value[1]) < 1e-6)).toBe(true);
    expect(rotation.keyframes.at(-1)?.value).toBeCloseTo(360, 6);
  });

  it('composes simultaneous additive transform animations instead of overwriting one channel', async () => {
    const transform = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
        <circle cx="25" cy="50" r="5" transform="translate(10 0)">
          <animateTransform attributeName="transform" type="scale" from="1" to="2" dur="1s" additive="sum" fill="freeze"/>
          <animateTransform attributeName="transform" type="rotate" from="0" to="90" dur="1s" additive="sum" fill="freeze"/>
        </circle>
      </svg>
    `);
    const position = transform.position as Keyframed<IRVec3>;
    const scale = transform.scale as Keyframed<IRVec3>;
    const rotation = transform.rotation!.z as Keyframed<number>;

    expect(position.keyframes.at(-1)?.value[0]).toBeCloseTo(-90, 5);
    expect(position.keyframes.at(-1)?.value[1]).toBeCloseTo(50, 5);
    expect(scale.keyframes.at(-1)?.value).toEqual([2, 2, 1]);
    expect(rotation.keyframes.at(-1)?.value).toBeCloseTo(90, 6);
  });

  it('densifies sampled transform composition at half-frame boundaries', async () => {
    const transform = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <circle cx="12" cy="12" r="10" transform="translate(12 12) scale(0)">
          <animateTransform attributeName="transform" type="translate"
            calcMode="spline" values="12 12;0 0" dur="1.2s"
            keySplines=".52,.6,.25,.99"/>
          <animateTransform attributeName="transform" type="scale" additive="sum"
            calcMode="spline" values="0;1" dur="1.2s"
            keySplines=".52,.6,.25,.99"/>
        </circle>
      </svg>
    `);
    const scale = transform.scale as Keyframed<IRVec3>;

    expect(scale.keyframes.some(keyframe => Math.abs(keyframe.frame - 0.5) < 1e-9)).toBe(true);
    expect(scale.keyframes.some(keyframe => Math.abs(keyframe.frame - 1.5) < 1e-9)).toBe(true);
  });

  it('maps animateMotion path and rotate=auto onto position and rotation tracks', async () => {
    const transform = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <g transform="translate(5 7)">
          <circle cx="0" cy="0" r="5">
            <animateMotion path="M0 0 C30 0 70 40 100 40" dur="2s" rotate="auto" fill="freeze"/>
          </circle>
        </g>
      </svg>
    `);
    const position = transform.position as Keyframed<IRVec3>;
    const rotation = transform.rotation!.z as Keyframed<number>;

    expect(position.type === 'keyframed').toBe(true);
    expect(position.keyframes[0].value).toEqual([5, 7, 0]);
    expect(position.keyframes.at(-1)?.value).toEqual([105, 47, 0]);
    expect(position.keyframes.find(keyframe => keyframe.frame === 30)?.value[0]).toBeCloseTo(55, 1);
    expect(position.keyframes.find(keyframe => keyframe.frame === 30)?.value[1]).toBeCloseTo(27, 1);
    expect(rotation.keyframes[0].value).toBeCloseTo(0, 6);
    expect(rotation.keyframes.find(keyframe => keyframe.frame === 30)?.value).toBeCloseTo(29.7449, 1);
    expect(rotation.keyframes.at(-1)?.value).toBeCloseTo(0, 6);
  });

  it('collects path and point-list geometry animations', async () => {
    const cases = [
      '<path id="target" d="M0 0 L20 0 L20 20 Z"><animate attributeName="d" values="M0 0 L20 0 L20 20 Z;M0 0 L30 0 L20 30 Z" dur="1s" fill="freeze"/></path>',
      '<polygon id="target" points="0 0 20 0 20 20"><animate attributeName="points" values="0 0 20 0 20 20;0 0 30 0 20 30" dur="1s" fill="freeze"/></polygon>',
      '<polyline id="target" points="0 0 20 0 20 20"><animate attributeName="points" values="0 0 20 0 20 20;0 0 30 0 20 30" dur="1s" fill="freeze"/></polyline>',
    ];

    for (const shape of cases) {
      const result = splitSVG(`
        <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
          ${shape}
        </svg>
      `);
      const animation = result.preservedData.shapeAnimationsByLayerId?.get('0');

      expect(animation?.keyframes.length).toBeGreaterThan(1);
    }
  });

  it('resolves mpath references to line, rect, circle and ellipse geometry', async () => {
    const cases = [
      { tag: '<line id="route" x1="20" y1="30" x2="120" y2="30" display="none"/>', start: [25, 35, 0] },
      { tag: '<rect id="route" x="20" y="30" width="100" height="50" display="none"/>', start: [25, 35, 0] },
      { tag: '<circle id="route" cx="50" cy="60" r="20" display="none"/>', start: [35, 65, 0] },
      { tag: '<ellipse id="route" cx="50" cy="60" rx="30" ry="20" display="none"/>', start: [25, 65, 0] },
    ] as const;

    for (const { tag, start } of cases) {
      const result = convertSVGToIR(`
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
          ${tag}
          <rect id="moving" width="10" height="10">
            <animateMotion dur="1s" fill="freeze"><mpath href="#route"/></animateMotion>
          </rect>
        </svg>
      `);
      const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'moving')!;
      const position = layer.transform!.position as Keyframed<IRVec3>;

      expect(position.type).toBe('keyframed');
      expect(position.keyframes[0]?.value).toEqual(start);
    }
  });

  it('ignores animateMotion when values contains invalid scalar motion points', async () => {
    const transform = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <circle cx="25" cy="50" r="5">
          <animateMotion path="M0 0 L100 0" values="0;0.5" keyTimes="0;0.5"
            calcMode="spline" keySplines="0.3 0 0.2 1" dur="1s" fill="freeze"/>
        </circle>
      </svg>
    `);

    expect(transform.position).toEqual({ type: 'static', value: [25, 50, 0] });
    expect(transform.scale).toEqual({ type: 'static', value: [1, 1, 1] });
    expect(transform.rotation?.z).toEqual({ type: 'static', value: 0 });
  });

  it('propagates an animated group transform to every rendered descendant', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
        <g transform="translate(5 0)">
          <animateTransform attributeName="transform" type="translate" from="5 0" to="55 0" dur="1s" fill="freeze"/>
          <rect id="left" x="0" y="0" width="20" height="20"/>
          <circle id="right" cx="40" cy="10" r="10"/>
        </g>
      </svg>
    `);
    const left = result.ir.compositions[0].layers.find(layer => layer.name === 'left')!;
    const right = result.ir.compositions[0].layers.find(layer => layer.name === 'right')!;
    const leftPosition = left.transform!.position as Keyframed<IRVec3>;
    const rightPosition = right.transform!.position as Keyframed<IRVec3>;

    expect(leftPosition.type === 'keyframed').toBe(true);
    expect(leftPosition.keyframes[0].value).toEqual([15, 10, 0]);
    expect(leftPosition.keyframes.at(-1)?.value).toEqual([65, 10, 0]);
    expect(rightPosition.keyframes[0].value).toEqual([45, 10, 0]);
    expect(rightPosition.keyframes.at(-1)?.value).toEqual([95, 10, 0]);
  });

  it('keeps ancestor discrete transform jumps sharp after sampled composition', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <g>
          <circle id="dot" cx="20" cy="0" r="2"/>
          <animateTransform attributeName="transform" type="rotate" calcMode="discrete"
            values="0 0 0;90 0 0;180 0 0" dur="0.9s" fill="freeze"/>
        </g>
      </svg>
    `);
    const position = result.ir.compositions[0].layers.find(layer => layer.name === 'dot')!.transform!.position as Keyframed<IRVec3>;
    const beforeJump = position.keyframes.find(keyframe => Math.abs(keyframe.frame - 8.999) < 1e-6);
    const atJump = position.keyframes.find(keyframe => Math.abs(keyframe.frame - 9) < 1e-6);

    expect(beforeJump?.value[0]).toBeCloseTo(20, 6);
    expect(beforeJump?.value[1]).toBeCloseTo(0, 6);
    expect(atJump?.value[0]).toBeCloseTo(0, 6);
    expect(atJump?.value[1]).toBeCloseTo(20, 6);
  });

  it('composes an animated group rotation with a child rotate pivot', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <g>
          <rect id="bar" x="11" y="1" width="2" height="5" transform="rotate(30 12 12)"/>
          <animateTransform attributeName="transform" type="rotate" calcMode="discrete"
            values="0 12 12;90 12 12;180 12 12" dur="1s" fill="freeze"/>
        </g>
      </svg>
    `);
    const transform = result.ir.compositions[0].layers.find(layer => layer.name === 'bar')!.transform!;
    const position = transform.position as Keyframed<IRVec3>;
    const rotation = transform.rotation!.z as Keyframed<number>;
    const atQuarterTurn = position.keyframes.find(keyframe => keyframe.frame === 15);

    expect(position.keyframes[0].value[0]).toBeCloseTo(16.25, 5);
    expect(position.keyframes[0].value[1]).toBeCloseTo(4.638785, 5);
    expect(atQuarterTurn?.value[0]).toBeCloseTo(19.361216, 5);
    expect(atQuarterTurn?.value[1]).toBeCloseTo(16.25, 5);
    expect(rotation.keyframes.find(keyframe => keyframe.frame === 15)?.value).toBeCloseTo(120, 6);
  });

  it('multiplies animated group opacity through every descendant layer', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
        <g opacity="1">
          <animate attributeName="opacity" values="1;0.25" dur="1s" fill="freeze"/>
          <rect id="box" x="0" y="0" width="20" height="20"/>
          <text id="label" x="40" y="20">Rich</text>
        </g>
      </svg>
    `);

    for (const name of ['box', 'label']) {
      const opacity = result.ir.compositions[0].layers.find(layer => layer.name === name)!.transform!.opacity as Keyframed<number>;

      expect(opacity.type === 'keyframed').toBe(true);
      expect(opacity.keyframes[0].value).toBeCloseTo(1, 6);
      expect(opacity.keyframes.at(-1)?.value).toBeCloseTo(0.25, 6);
    }
  });

  it('composes sequential opacity animations on the same element', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <path id="wifi-band" d="M2 12 L12 2 L22 12" opacity="0">
          <animate id="show" attributeName="opacity" begin="0" calcMode="discrete"
            dur="0.25s" values="0;1" fill="freeze"/>
          <animate attributeName="opacity" begin="show.end+0.5s"
            dur="0.001s" values="1;0" fill="freeze"/>
        </path>
      </svg>
    `);
    const opacity = result.ir.compositions[0].layers.find(layer => layer.name === 'wifi-band')!
      .transform!.opacity as Keyframed<number>;

    expect(opacity.type === 'keyframed').toBe(true);
    expect(opacity.keyframes.find(keyframe => keyframe.frame === 15)?.value).toBe(1);
    expect(opacity.keyframes.at(-1)?.value).toBe(0);
    expect(new Set(opacity.keyframes.map(keyframe => keyframe.value)).size).toBeGreaterThan(1);
  });

  it('keeps rich-text paint alpha separate from static and animated element opacity', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="320" height="100">
        <g opacity="0.4">
          <text id="direct" x="20" y="30" fill="rgba(255,255,255,0.8)" fill-opacity="0.5" opacity="0.6">Direct
            <animate attributeName="opacity" values="0;0.5" dur="1s" fill="freeze"/>
          </text>
        </g>
        <g opacity="0.2">
          <animate attributeName="opacity" values="0;0.5" dur="1s" fill="freeze"/>
          <text id="ancestor" x="20" y="70" fill="rgba(255,255,255,0.8)" fill-opacity="0.5" opacity="0.6">Ancestor</text>
        </g>
      </svg>
    `);
    const direct = result.ir.compositions[0].layers.find(layer => layer.name === 'direct')!;
    const ancestor = result.ir.compositions[0].layers.find(layer => layer.name === 'ancestor')!;
    const directOpacity = direct.transform!.opacity as Keyframed<number>;
    const ancestorOpacity = ancestor.transform!.opacity as Keyframed<number>;

    // Paint alpha only carries rgba alpha × fill-opacity. Element/group opacity
    // belongs exclusively to the SpriteColorTrack so SMIL replace does not
    // multiply the authored static opacity a second time.
    expect((direct as unknown as { content: { color: number[] } }).content.color[3]).toBeCloseTo(0.4, 6);
    expect((ancestor as unknown as { content: { color: number[] } }).content.color[3]).toBeCloseTo(0.4, 6);
    expect(directOpacity.keyframes[0].value).toBeCloseTo(0, 6);
    expect(directOpacity.keyframes.at(-1)?.value).toBeCloseTo(0.2, 6);
    expect(ancestorOpacity.keyframes[0].value).toBeCloseTo(0, 6);
    expect(ancestorOpacity.keyframes.at(-1)?.value).toBeCloseTo(0.3, 6);
  });

  it('animates a text layer transform without leaving the strategy rich-text path', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="240" height="80">
        <text id="moving-label" x="20" y="40" font-size="20">Moving
          <animateTransform attributeName="transform" type="translate" from="0 0" to="100 0" dur="1s" fill="freeze"/>
        </text>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'moving-label')!;

    const position = layer.transform!.position as Keyframed<IRVec3>;

    expect(position.type === 'keyframed').toBe(true);
    expect(position.keyframes.at(-1)!.value[0] - position.keyframes[0].value[0]).toBeCloseTo(100, 6);
  });

  it('keeps SMIL children on strategy rich text without svg parser rebuild errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = convertSVGToIR(`
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">
          <text id="status" x="100" y="40" text-anchor="middle" fill="#fff" opacity="0.8">
            <animate attributeName="opacity" values="0.8;0" dur="1s" fill="freeze"/>
            Loading
          </text>
        </svg>
      `);
      const opacity = result.ir.compositions[0].layers.find(layer => layer.name === 'status')!.transform!.opacity as Keyframed<number>;

      expect(opacity.keyframes[0].value).toBeCloseTo(0.8, 6);
      expect(opacity.keyframes.at(-1)?.value).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('maps circle radius and center geometry animation onto transform tracks', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <circle id="pulse" cx="20" cy="30" r="0">
          <animate attributeName="r" values="0;10;0" dur="1s" fill="freeze"/>
          <animate attributeName="cx" values="20;40;20" dur="1s" fill="freeze"/>
        </circle>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'pulse')!;
    const position = layer.transform!.position as Keyframed<IRVec3>;
    const scale = layer.transform!.scale as Keyframed<IRVec3>;
    const shape = (layer as unknown as { content: { shapes: Array<{ xRadius: number; yRadius: number }> } }).content.shapes[0];

    expect(shape.xRadius).toBe(10);
    expect(shape.yRadius).toBe(10);
    expect(position.keyframes.find(keyframe => keyframe.frame === 15)?.value).toEqual([40, 30, 0]);
    expect(scale.keyframes.find(keyframe => keyframe.frame === 15)?.value).toEqual([1, 1, 1]);
    expect(scale.keyframes[0].value).toEqual([0, 0, 1]);
  });

  it('maps uniform line endpoint animation to layer translation', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <line x1="0" y1="10" x2="10" y2="10" stroke="black">
          <animate attributeName="x1" values="0;20" dur="1s" fill="freeze"/>
          <animate attributeName="x2" values="10;30" dur="1s" fill="freeze"/>
        </line>
      </svg>
    `);
    const transform = result.ir.compositions[0].layers[0].transform!;
    const position = transform.position as Keyframed<IRVec3>;

    expect(position.keyframes[0]?.value).toEqual([5, 10, 0]);
    expect(position.keyframes.at(-1)?.value).toEqual([25, 10, 0]);
    expect(result.warnings.some(warning => warning.message.includes('<animate>'))).toBe(false);
  });

  it('reports line endpoint animation that cannot be represented as translation', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <line x1="0" y1="10" x2="10" y2="10" stroke="black">
          <animate attributeName="x1" values="0;20" dur="1s" fill="freeze"/>
          <animate attributeName="x2" values="10;25" dur="1s" fill="freeze"/>
        </line>
      </svg>
    `);
    const position = result.ir.compositions[0].layers[0].transform!.position;

    expect(position?.type).toBe('static');
    expect(result.warnings.some(warning => warning.message.includes('<animate>'))).toBe(true);
  });

  it('keeps non-zero circle geometry at its authored radius and animates scale from one', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">
        <circle id="dot" cx="20" cy="20" r="1">
          <animate attributeName="r" values="1;2;1" dur="0.6s"/>
        </circle>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'dot')!;
    const shape = (layer as unknown as { content: { shapes: Array<{ xRadius: number; yRadius: number }> } }).content.shapes[0];
    const scale = layer.transform!.scale as Keyframed<IRVec3>;

    expect(shape.xRadius).toBe(1);
    expect(shape.yRadius).toBe(1);
    expect(scale.keyframes[0].value).toEqual([1, 1, 1]);
    expect(scale.keyframes.find(keyframe => keyframe.frame === 9)?.value).toEqual([2, 2, 1]);
  });

  it('maps rect x/y/width/height animation onto position and scale tracks', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect id="bar" x="10" y="20" width="10" height="20">
          <animate attributeName="y" values="20;10;20" dur="1s"/>
          <animate attributeName="height" values="20;40;20" dur="1s"/>
        </rect>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers.find(candidate => candidate.name === 'bar')!;
    const position = layer.transform!.position as Keyframed<IRVec3>;
    const scale = layer.transform!.scale as Keyframed<IRVec3>;

    expect(position.keyframes.find(keyframe => keyframe.frame === 15)?.value).toEqual([15, 30, 0]);
    expect(scale.keyframes.find(keyframe => keyframe.frame === 15)?.value).toEqual([1, 2, 1]);
    expect(scale.keyframes[0].value).toEqual([1, 1, 1]);
  });

  it('uses the SMIL active duration for composition and layer lifetime', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="20" height="20">
          <animate attributeName="opacity" from="1" to="0" dur="2s"/>
        </rect>
      </svg>
    `);

    expect(result.ir.compositions[0].outPoint).toBe(60);
    expect(result.ir.compositions[0].layers[0].time).toEqual({ inFrame: 0, outFrame: 60 });
  });

  it('restores the underlying value when a shorter animation ends without fill=freeze', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
        <circle cx="25" cy="50" r="15" transform="translate(10 20)">
          <animateTransform attributeName="transform" type="translate" from="0 0" to="50 0" dur="1s"/>
          <animate attributeName="opacity" from="1" to="0.5" dur="2s"/>
        </circle>
      </svg>
    `);
    const position = result.ir.compositions[0].layers[0].transform!.position as Keyframed<IRVec3>;

    expect(result.ir.compositions[0].outPoint).toBe(60);
    expect(position.keyframes.some(keyframe => keyframe.frame > 29.99 && keyframe.frame < 30 && keyframe.value[0] === 75)).toBe(true);
    expect(position.keyframes.some(keyframe => keyframe.frame === 30 && keyframe.value[0] === 35 && keyframe.value[1] === 70)).toBe(true);
  });

  it('expands numeric repeatCount instead of stretching one interpolation', async () => {
    const transform = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="20" height="20">
          <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="2"/>
        </rect>
      </svg>
    `);
    const opacity = transform.opacity as Keyframed<number>;

    expect(opacity.keyframes.map(kf => ({ frame: kf.frame, value: kf.value }))).toEqual([
      { frame: 0, value: 1 },
      { frame: 15, value: 0 },
      { frame: 30, value: 1 },
      { frame: 45, value: 0 },
      { frame: 60, value: 1 },
    ]);
  });

  it('uses repeatDur without repeatCount and keeps repeat-boundary frames strictly ordered', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="20" height="20">
          <animate attributeName="opacity" values="0;1" dur="1s" repeatDur="2.5s"/>
        </rect>
      </svg>
    `);
    const opacity = result.ir.compositions[0].layers[0].transform!.opacity as Keyframed<number>;
    const frames = opacity.keyframes.map(keyframe => keyframe.frame);

    expect(result.ir.compositions[0].outPoint).toBe(75);
    expect(opacity.keyframes.some(keyframe => keyframe.frame === 30 && keyframe.value === 0)).toBe(true);
    expect(opacity.keyframes.some(keyframe => keyframe.frame === 60 && keyframe.value === 0)).toBe(true);
    expect(frames.every((frame, index) => index === 0 || frame > frames[index - 1])).toBe(true);
  });

  it('maps discrete and spline timing to IR hold/bezier tangents', async () => {
    const discrete = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="20" height="20">
          <animate attributeName="opacity" values="1;0;1" keyTimes="0;0.5;1" calcMode="discrete" dur="1s"/>
        </rect>
      </svg>
    `);
    const discreteOpacity = discrete.opacity as Keyframed<number>;

    expect(discreteOpacity.keyframes.find(kf => kf.frame === 0)?.hold).toBe(true);
    expect(discreteOpacity.keyframes.find(kf => kf.frame === 15)?.hold).toBe(true);
    expect(discreteOpacity.keyframes.at(-1)?.hold ?? false).toBe(false);
    expect(discreteOpacity.keyframes.some(kf => kf.frame > 14.99 && kf.frame < 15)).toBe(true);

    const spline = firstLayerTransform(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="20" height="20">
          <animate attributeName="opacity" from="0" to="1" calcMode="spline" keySplines="0.42 0 0.58 1" dur="1s"/>
        </rect>
      </svg>
    `);
    const splineOpacity = spline.opacity as Keyframed<number>;

    expect(splineOpacity.keyframes[0].outTangent).toEqual({ x: 0.42, y: 0 });
    expect(splineOpacity.keyframes[1].inTangent).toEqual({ x: 0.58, y: 1 });
  });

  it('resolves syncbase begin offsets and repeats indefinite animation through the composition', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect id="first" width="20" height="20">
          <animate id="fadeA" attributeName="opacity" from="1" to="0" begin="0.5s" dur="1s"/>
        </rect>
        <rect id="second" x="30" width="20" height="20">
          <animate attributeName="opacity" from="0" to="1" begin="fadeA.end-0.25s" dur="1s"/>
        </rect>
        <rect id="loop" x="60" width="20" height="20">
          <animate attributeName="opacity" from="1" to="0" dur="1s" repeatCount="indefinite"/>
        </rect>
      </svg>
    `);
    const second = result.ir.compositions[0].layers.find(layer => layer.name === 'second')!;
    const loop = result.ir.compositions[0].layers.find(layer => layer.name === 'loop')!;
    const secondOpacity = second.transform!.opacity as Keyframed<number>;
    const loopOpacity = loop.transform!.opacity as Keyframed<number>;

    expect(result.ir.compositions[0].outPoint).toBe(67.5);
    expect(secondOpacity.keyframes.map(keyframe => keyframe.frame)).toEqual([0, 37.5, 67.5]);
    expect(secondOpacity.keyframes[0].hold).toBe(true);
    expect(loopOpacity.keyframes.map(keyframe => keyframe.frame)).toEqual([0, 29.999, 30, 59.999, 60, 67.5]);
    expect(loopOpacity.keyframes.find(keyframe => keyframe.frame === 30)?.value).toBe(1);
  });

  it('keeps scheduling cyclic syncbase begin events through the composition window', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="40">
        <rect id="first" width="20" height="20">
          <animate id="pulseA" attributeName="opacity" values="1;0;1"
            begin="0;pulseC.end+0.4s" dur="0.6s"/>
        </rect>
        <rect id="second" x="30" width="20" height="20">
          <animate id="pulseB" attributeName="opacity" values="1;0;1"
            begin="pulseA.begin+0.1s" dur="0.6s"/>
        </rect>
        <rect id="third" x="60" width="20" height="20">
          <animate id="pulseC" attributeName="opacity" values="1;0;1"
            begin="pulseB.begin+0.1s" dur="0.6s"/>
        </rect>
        <rect x="90" width="20" height="20">
          <animate attributeName="opacity" values="1;1" dur="2.4s"/>
        </rect>
      </svg>
    `);
    const opacityOf = (name: string) => result.ir.compositions[0].layers.find(layer => layer.name === name)!
      .transform!.opacity as Keyframed<number>;

    expect(result.ir.compositions[0].outPoint).toBe(72);
    expect(opacityOf('first').keyframes.some(keyframe => Math.abs(keyframe.frame - 45) < 1e-6 && keyframe.value === 0)).toBe(true);
    expect(opacityOf('second').keyframes.some(keyframe => Math.abs(keyframe.frame - 48) < 1e-6 && keyframe.value === 0)).toBe(true);
    expect(opacityOf('third').keyframes.some(keyframe => Math.abs(keyframe.frame - 51) < 1e-6 && keyframe.value === 0)).toBe(true);
  });

  it('preserves the phase of a negative begin on an indefinite animation', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="20" height="20">
          <animate attributeName="opacity" values="1;0" begin="-0.75s" dur="1s" repeatCount="indefinite"/>
        </rect>
      </svg>
    `);
    const opacity = result.ir.compositions[0].layers[0].transform!.opacity as Keyframed<number>;

    expect(result.ir.compositions[0].outPoint).toBe(30);
    expect(opacity.keyframes[0].frame).toBe(0);
    expect(opacity.keyframes[0].value).toBeCloseTo(0.25, 6);
    expect(opacity.keyframes.some(keyframe => keyframe.frame === 7.5 && keyframe.value === 1)).toBe(true);
  });

  it('preserves spline easing when a negative-begin repeat is clipped at the comparison end', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">
        <circle cx="22" cy="22" r="1">
          <animate attributeName="r" begin="-0.9s" dur="1.8s"
            values="1;20" calcMode="spline" keyTimes="0;1"
            keySplines="0.165 0.84 0.44 1" repeatCount="indefinite"/>
        </circle>
      </svg>
    `);
    const scale = result.ir.compositions[0].layers[0].transform!.scale as Keyframed<IRVec3>;
    const atOnePointFive = scale.keyframes.find(keyframe => keyframe.frame === 45);

    // t=1.5s is the middle of the second cycle (the first cycle starts at
    // -0.9s). The fractional comparison-end keyframe must use the authored
    // spline, not a linear fallback, otherwise GE renders a much smaller ring.
    expect(atOnePointFive?.value[0]).toBeCloseTo(16.15, 1);
  });

  it('splits a spline at a syncbase interval end clipped inside the authored segment', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <path d="M0 0 L1 0">
          <animate id="first" attributeName="opacity" begin="0;second.begin+0.6s"
            calcMode="spline" dur="1.2s" values="1;0"
            keySplines=".52,.6,.25,.99"/>
        </path>
        <path d="M0 0 L1 0">
          <animate id="second" attributeName="opacity" begin="first.begin+0.6s"
            calcMode="spline" dur="1.2s" values="1;0"
            keySplines=".52,.6,.25,.99"/>
        </path>
      </svg>
    `);
    const first = result.ir.compositions[0].layers.find(layer => layer.id === '0')!;
    const opacity = first.transform!.opacity as Keyframed<number>;
    const authoredEnd = opacity.keyframes.find(keyframe => Math.abs(keyframe.frame - 53.999) < 1e-6)!;
    const intervalStart = opacity.keyframes.find(keyframe => Math.abs(keyframe.frame - 36) < 1e-6)!;

    // The comparison window ends halfway through the 1.2s interval that
    // begins at 1.2s. GE must receive the left half of the authored cubic,
    // not the original full-segment tangents attached to the clipped value.
    expect(intervalStart.outTangent?.x).toBeCloseTo(0.662638, 5);
    expect(intervalStart.outTangent?.y).toBeCloseTo(0.451271, 5);
    expect(authoredEnd.inTangent?.x).toBeCloseTo(0.683855, 5);
    expect(authoredEnd.inTangent?.y).toBeCloseTo(0.801906, 5);
  });

  it('keeps an initially hidden shape renderable when visibility is animated', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <circle visibility="hidden" r="20">
          <set attributeName="visibility" to="visible" begin="1s" dur="1s" fill="freeze"/>
        </circle>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers[0];
    const opacity = layer.transform!.opacity as Keyframed<number>;

    expect(layer.visible).toBe(true);
    expect(opacity.keyframes.find(keyframe => Math.abs(keyframe.frame - 29.999) < 1e-6)?.value).toBe(0);
    expect(opacity.keyframes.find(keyframe => keyframe.frame === 30)?.value).toBe(1);
  });

  it('resolves calc length values and honors replace on by animations', async () => {
    const convertWidth = (animation: string) => convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="150">
        <rect width="10" height="20">${animation}</rect>
      </svg>
    `).ir.compositions[0].layers[0].transform?.scale;
    const additiveScale = convertWidth('<animate attributeName="width" by="calc(4% + 8px)" dur="1s" fill="freeze"/>');
    const replaceScale = convertWidth('<animate attributeName="width" additive="replace" by="calc(10% + 10px)" dur="1s" fill="freeze"/>');

    expect(additiveScale?.type).toBe('keyframed');
    expect(replaceScale?.type).toBe('keyframed');
    if (additiveScale?.type !== 'keyframed' || replaceScale?.type !== 'keyframed') {
      throw new Error('Expected keyframed geometry transforms.');
    }
    expect(additiveScale.keyframes.at(-1)?.value[0]).toBeCloseTo(5, 6);
    expect(replaceScale.keyframes.at(-1)?.value[0]).toBeCloseTo(10, 6);
  });

  it('uses the motion origin for a to-only animateMotion', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
        <rect width="10" height="10">
          <animateMotion to="100,0" dur="1s" fill="freeze"/>
        </rect>
      </svg>
    `);
    const position = result.ir.compositions[0].layers[0].transform!.position as Keyframed<IRVec3>;

    expect(position.keyframes.at(-1)?.value).toEqual([105, 5, 0]);
  });

  it('treats scale by-only animation as zero-to-delta', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <circle cx="50" cy="50" r="20">
          <animateTransform attributeName="transform" type="scale" by="1" begin="1s" dur="3s" fill="freeze"/>
        </circle>
      </svg>
    `);
    const scale = result.ir.compositions[0].layers[0].transform!.scale as Keyframed<IRVec3>;
    const valueAt = (frame: number) => scale.keyframes.find(keyframe => Math.abs(keyframe.frame - frame) < 1e-6)?.value;

    expect(valueAt(30)).toEqual([0, 0, 1]);
    expect(valueAt(120)).toEqual([1, 1, 1]);
  });

  it('interpolates animateMotion values by authored point order', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect x="0" y="0" width="10" height="10">
          <animateMotion values="0,200; 0,167; 0,111; 0,0" calcMode="linear" dur="8s" fill="freeze"/>
        </rect>
      </svg>
    `);
    const position = result.ir.compositions[0].layers[0].transform!.position as Keyframed<IRVec3>;
    const valueAt = (frame: number) => position.keyframes.find(keyframe => Math.abs(keyframe.frame - frame) < 1e-6)?.value;

    expect(valueAt(80)).toEqual([5, 172, 0]);
    expect(valueAt(120)).toEqual([5, 144, 0]);
  });

  it('keeps a delayed syncbase opacity animation hidden until its begin time', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
        <g id="first-layer" opacity="0">
          <animate id="first" attributeName="opacity" from="0" to="1" begin="0ms" dur="10ms" fill="freeze"/>
          <rect width="50" height="50"/>
        </g>
        <g id="second-layer" opacity="0">
          <animate attributeName="opacity" from="1" to="1" begin="first.end+10ms" dur="10ms" fill="freeze"/>
          <rect x="50" width="50" height="50"/>
        </g>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers[1];
    const opacity = layer.transform!.opacity as Keyframed<number>;

    expect(opacity.keyframes.some(keyframe => Math.abs(keyframe.frame - 0.599) < 1e-6 && keyframe.value === 0)).toBe(true);
    expect(opacity.keyframes.some(keyframe => Math.abs(keyframe.frame - 0.6) < 1e-6 && keyframe.value === 1)).toBe(true);
  });

  it('uses from as the starting value for a from-by animation', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="10" height="10">
          <animate attributeName="width" from="10" by="40" dur="1s" fill="freeze"/>
        </rect>
      </svg>
    `);
    const transform = result.ir.compositions[0].layers[0].transform!;
    const scale = transform.scale as Keyframed<IRVec3>;

    expect(scale.keyframes[0].value).toEqual([1, 1, 1]);
    expect(scale.keyframes.at(-1)?.value).toEqual([5, 1, 1]);
  });

  it('gives priority to the animation that starts later', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
        <rect width="10" height="10">
          <animate attributeName="x" from="20" to="30" begin="1.5s" dur="1s" fill="freeze"/>
          <animate attributeName="x" from="0" to="10" begin="0s" dur="1s" fill="freeze"/>
        </rect>
      </svg>
    `);
    const position = result.ir.compositions[0].layers[0].transform!.position as Keyframed<IRVec3>;

    expect(position.keyframes.find(keyframe => keyframe.frame === 45)?.value).toEqual([25, 5, 0]);
    expect(position.keyframes.find(keyframe => keyframe.frame === 75)?.value).toEqual([35, 5, 0]);
  });

  it('uses a zero-sized geometry set as the animated shape reference', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect id="bar" width="0" height="20">
          <set attributeName="width" to="100" begin="1s"/>
        </rect>
      </svg>
    `);
    const layer = result.ir.compositions[0].layers[0];
    const shape = layer.type === 'shape' ? layer.content.shapes[0] : undefined;
    const rectangle = shape != null && 'width' in shape ? shape : undefined;
    const scale = layer.transform?.scale;

    expect(shape?.primitiveType).toBe('rectangle');
    expect(rectangle?.width).toBe(100);
    expect(scale?.type).toBe('keyframed');
  });

  it('keeps a set without dur active through the comparison window', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">
        <rect width="100" height="100" fill="red"/>
        <rect width="100" height="100" fill="green">
          <set attributeName="x" to="200" begin="1s" dur="1s" fill="freeze"/>
          <set attributeName="x" to="100" begin="4s" fill="freeze"/>
        </rect>
      </svg>
    `);
    const position = result.ir.compositions[0].layers[1].transform!.position as Keyframed<IRVec3>;

    expect(result.ir.compositions[0].outPoint).toBe(120);
    expect(position.keyframes.find(keyframe => keyframe.frame === 60)?.value).toEqual([250, 50, 0]);
    expect(position.keyframes.find(keyframe => keyframe.frame === 120)?.value).toEqual([150, 50, 0]);
  });

  it('ignores trailing empty segments in numeric values', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="50">
        <rect width="20" height="20">
          <animate attributeName="x" values="0;100;" dur="1s" fill="freeze"/>
        </rect>
      </svg>
    `);
    const position = result.ir.compositions[0].layers[0].transform!.position as Keyframed<IRVec3>;

    expect(position.keyframes.at(-1)?.value).toEqual([110, 10, 0]);
  });

  it('accumulates the final value across repeats', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="10" height="10">
          <animate attributeName="height" from="10" to="20" dur="1s" repeatCount="2" accumulate="sum" fill="freeze"/>
        </rect>
      </svg>
    `);
    const scale = result.ir.compositions[0].layers[0].transform!.scale as Keyframed<IRVec3>;

    expect(scale.keyframes.find(keyframe => keyframe.frame === 30)?.value).toEqual([1, 3, 1]);
    expect(scale.keyframes.at(-1)?.value).toEqual([1, 4, 1]);
  });

  it('supports a single-value animation without dur', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="50">
        <rect width="10" height="10">
          <animate attributeName="width" values="100" begin="1s"/>
        </rect>
      </svg>
    `);
    const scale = result.ir.compositions[0].layers[0].transform!.scale as Keyframed<IRVec3>;

    expect(result.ir.compositions[0].outPoint).toBe(30);
    expect(scale.keyframes.find(keyframe => keyframe.frame === 30)?.value).toEqual([10, 1, 1]);
  });

  it('honors animateMotion keyPoints with the default paced mode', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" fill="red"/>
        <rect id="target" transform="translate(100, -50)" width="100" height="100" fill="green">
          <animateMotion dur="5s" keyPoints="1;0" keyTimes="0;1" path="M-200,50h250"/>
        </rect>
      </svg>
    `);
    const target = result.ir.compositions[0].layers.find(layer => layer.name === 'target')!;
    const position = target.transform!.position as Keyframed<IRVec3>;

    expect(position.keyframes[0].value).toEqual([200, 50, 0]);
    expect(position.keyframes.find(keyframe => keyframe.frame === 75)?.value[0]).toBeCloseTo(75, 6);
    expect(position.keyframes.at(-1)?.value).toEqual([150, 0, 0]);
  });
  it('switch 会跳过不满足条件的分支', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <switch>
          <g requiredFeatures="http://example.invalid/unsupported"><rect id="unsupported" width="10" height="10"/></g>
          <g><rect id="supported" x="20" width="10" height="10"/></g>
        </switch>
      </svg>
    `);

    expect(result.ir.compositions[0].layers.map(layer => layer.name)).toEqual(['supported']);
  });

  it('switch 会跳过不匹配当前语言的分支', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <switch>
          <g systemLanguage="x-xl"><rect id="unsupported" width="10" height="10"/></g>
          <g><rect id="supported" x="20" width="10" height="10"/></g>
        </switch>
      </svg>
    `);

    expect(result.ir.compositions[0].layers.map(layer => layer.name)).toEqual(['supported']);
  });
  it('结构容器 a 的 transform 动画会传递给子图形', async () => {
    const result = convertSVGToIR(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <a transform="translate(10 0)">
          <animateTransform attributeName="transform" type="translate" from="0 0" to="20 0" dur="1s" fill="freeze"/>
          <rect width="10" height="10"/>
        </a>
      </svg>
    `);
    const position = result.ir.compositions[0].layers[0].transform?.position;

    expect(position?.type).toBe('keyframed');
    if (position?.type !== 'keyframed') {
      throw new Error('Expected a keyframed structural transform.');
    }
    expect(position.keyframes.at(0)?.value).toEqual([5, 5, 0]);
    expect(position.keyframes.at(-1)?.value).toEqual([25, 5, 0]);
  });
});

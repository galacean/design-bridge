// Production-shaped GE fixtures for precomposition round-trip coverage.

export function createPrecompScene(): Record<string, unknown> {
  return {
    version: '3.6',
    playerVersion: { web: '2.8.9' },
    images: [{ id: 'image-1', url: 'https://example.com/child.png' }],
    fonts: [],
    plugins: [],
    type: 'ge',
    compositionId: 'root-comp',
    compositions: [
      {
        id: 'root-comp',
        name: 'Root',
        duration: 2,
        startTime: 0,
        endBehavior: 5,
        previewSize: [400, 300],
        components: [{ id: 'root-composition-component' }],
      },
      {
        id: 'child-comp',
        name: 'Child',
        duration: 2,
        startTime: 0,
        endBehavior: 5,
        previewSize: [400, 300],
        components: [{ id: 'child-composition-component' }],
      },
    ],
    components: [
      {
        id: 'root-composition-component',
        dataType: 'CompositionComponent',
        item: { id: 'root-comp' },
        items: [{ id: 'precomp-item' }],
      },
      {
        id: 'child-composition-component',
        dataType: 'CompositionComponent',
        item: { id: 'child-comp' },
        items: [{ id: 'child-item' }],
      },
      {
        id: 'sprite-component',
        dataType: 'SpriteComponent',
        item: { id: 'child-item' },
        renderer: { texture: { id: 'texture-1' }, anchor: [0.5, 0.5] },
      },
    ],
    geometries: [],
    materials: [],
    items: [
      {
        id: 'precomp-item',
        dataType: 'VFXItemData',
        name: 'ChildPrecomp',
        duration: 2,
        type: '7',
        visible: true,
        endBehavior: 4,
        delay: 0,
        renderLevel: 'B+',
        content: { options: { refId: 'child-comp' }, positionOverLifetime: {} },
        components: [],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          eulerHint: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      {
        id: 'child-item',
        dataType: 'VFXItemData',
        name: 'ChildImage',
        duration: 2,
        type: '1',
        visible: true,
        endBehavior: 0,
        delay: 0,
        renderLevel: 'B+',
        components: [{ id: 'sprite-component' }],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          eulerHint: { x: 0, y: 0, z: 0 },
          anchor: { x: 0, y: 0 },
          size: { x: 1.6, y: 1.2 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ],
    shaders: [],
    bins: [],
    textures: [{ id: 'texture-1', dataType: 'Texture', source: { id: 'image-1' }, flipY: true }],
    animations: [],
    miscs: [],
  };
}

export function createPrecompSceneWithSiblings(): Record<string, unknown> {
  const scene = structuredClone(createPrecompScene());
  const images = scene['images'] as Record<string, unknown>[];
  const textures = scene['textures'] as Record<string, unknown>[];
  const components = scene['components'] as Record<string, unknown>[];
  const items = scene['items'] as Record<string, unknown>[];
  const miscs = scene['miscs'] as Record<string, unknown>[];
  const childCompositionComponent = components.find(component => component['id'] === 'child-composition-component');

  images.push({ id: 'image-2', url: 'https://example.com/child-b.png' });
  textures.push({ id: 'texture-2', dataType: 'Texture', source: { id: 'image-2' }, flipY: true });
  components.push({
    id: 'sprite-component-b',
    dataType: 'SpriteComponent',
    item: { id: 'child-item-b' },
    renderer: { texture: { id: 'texture-2' }, anchor: [0.5, 0.5] },
  });
  items.push({
    id: 'child-item-b',
    dataType: 'VFXItemData',
    name: 'ChildImageB',
    duration: 2,
    type: '1',
    visible: true,
    endBehavior: 0,
    delay: 0,
    renderLevel: 'B+',
    components: [{ id: 'sprite-component-b' }],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      eulerHint: { x: 0, y: 0, z: 0 },
      anchor: { x: 0, y: 0 },
      size: { x: 1.6, y: 1.2 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });

  if (childCompositionComponent != null) {
    childCompositionComponent['items'] = [{ id: 'child-item-b' }, { id: 'child-item' }];
    childCompositionComponent['timelineAsset'] = { id: 'child-timeline' };
    childCompositionComponent['sceneBindings'] = [
      { key: { id: 'binding-b' }, value: { id: 'child-item-b' } },
      { key: { id: 'binding-a' }, value: { id: 'child-item' } },
    ];
  }

  miscs.push(
    {
      id: 'child-timeline',
      dataType: 'TimelineAsset',
      tracks: [{ id: 'binding-b' }, { id: 'binding-a' }],
    },
    {
      id: 'binding-a',
      dataType: 'ObjectBindingTrack',
      children: [{ id: 'activation-a' }],
      clips: [],
    },
    {
      id: 'binding-b',
      dataType: 'ObjectBindingTrack',
      children: [{ id: 'activation-b' }],
      clips: [],
    },
    {
      id: 'activation-a',
      dataType: 'ActivationTrack',
      clips: [{ start: 0, duration: 2, endBehavior: 0 }],
    },
    {
      id: 'activation-b',
      dataType: 'ActivationTrack',
      clips: [{ start: 0, duration: 2, endBehavior: 0 }],
    },
  );

  return scene;
}

export function createPrecompTextScene(): Record<string, unknown> {
  const scene = createPrecompScene();
  const component = findComponent(scene, 'sprite-component');
  const item = findItem(scene, 'child-item');

  if (component != null) {
    component['dataType'] = 'TextComponent';
    component['options'] = {
      text: 'Original',
      fontFamily: 'sans-serif',
      fontSize: 20,
      textColor: [1, 1, 1, 1],
      fontWeight: 'normal',
      letterSpace: 0,
      textAlign: 0,
      fontStyle: 'normal',
      autoWidth: true,
      textWidth: 80,
      textHeight: 40,
      lineHeight: 24,
    };
    component['renderer'] = { anchor: [0.5, 0.5] };
  }
  if (item != null) {
    item['type'] = 'text';
  }

  return scene;
}

export function createLegacyPrecompTextScene(): Record<string, unknown> {
  const scene = createPrecompTextScene();
  const component = findComponent(scene, 'sprite-component');
  const item = findItem(scene, 'child-item');
  const options = component?.['options'] as Record<string, unknown>;
  const renderer = component?.['renderer'] as Record<string, unknown>;
  const transform = item?.['transform'] as Record<string, unknown>;

  options['text'] = '日进斗金';
  options['fontSize'] = 68;
  options['textAlign'] = 1;
  options['textWidth'] = 274;
  options['textHeight'] = 107;
  options['lineHeight'] = 106.862;
  options['size'] = [2.3437, 0.9152];
  renderer['anchor'] = [0.501, 0.9258];
  transform['position'] = { x: 2.2356, y: 0.1343, z: 0 };
  transform['scale'] = { x: 2.3437, y: 0.9152, z: 1 };
  delete transform['size'];

  return scene;
}

export function createPrecompSceneWithMaskSource(): Record<string, unknown> {
  const scene = structuredClone(createPrecompScene());
  const images = scene['images'] as Record<string, unknown>[];
  const textures = scene['textures'] as Record<string, unknown>[];
  const components = scene['components'] as Record<string, unknown>[];
  const items = scene['items'] as Record<string, unknown>[];
  const childCompositionComponent = components.find(component => component['id'] === 'child-composition-component');
  const spriteComponent = components.find(component => component['id'] === 'sprite-component');

  images.push({
    id: 'mask-image',
    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  });
  textures.push({
    id: 'mask-texture',
    dataType: 'Texture',
    source: { id: 'mask-image' },
    flipY: true,
  });
  components.push({
    id: 'mask-component',
    dataType: 'SpriteComponent',
    item: { id: 'mask-item' },
    options: { startColor: [1, 1, 1, 0] },
    renderer: { texture: { id: 'mask-texture' }, anchor: [0.5, 0.5] },
    mask: { isMask: true, alphaMaskEnabled: false },
  });

  if (spriteComponent != null) {
    spriteComponent['mask'] = {
      isMask: false,
      references: [{ mask: { id: 'mask-component' } }],
      inverted: false,
    };
  }

  if (childCompositionComponent != null) {
    childCompositionComponent['items'] = [
      { id: 'mask-item' },
      ...((childCompositionComponent['items'] as Record<string, unknown>[] | undefined) ?? []),
    ];
  }

  items.push({
    id: 'mask-item',
    dataType: 'VFXItemData',
    name: 'mask',
    duration: 2,
    type: '1',
    visible: true,
    endBehavior: 0,
    delay: 0,
    renderLevel: 'B+',
    components: [{ id: 'mask-component' }],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      eulerHint: { x: 0, y: 0, z: 0 },
      anchor: { x: 0, y: 0 },
      size: { x: 4, y: 3 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });

  return scene;
}

function findItem(scene: Record<string, unknown>, itemId: string): Record<string, unknown> | undefined {
  return ((scene['items'] as Record<string, unknown>[]) ?? []).find(item => item['id'] === itemId);
}

function findComponent(scene: Record<string, unknown>, componentId: string): Record<string, unknown> | undefined {
  return ((scene['components'] as Record<string, unknown>[]) ?? []).find(
    component => component['id'] === componentId,
  );
}

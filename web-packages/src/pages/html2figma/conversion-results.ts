import type { SceneResult } from '@galacean/html2figma/browser';

export interface SceneConversionPartition {
  successfulScenes: SceneResult[];
  failedScenes: SceneResult[];
  failureMessage: string;
}

export function partitionSceneConversionResults(scenes: SceneResult[]): SceneConversionPartition {
  const successfulScenes = scenes.filter(scene => scene.sceneData !== undefined && scene.error === undefined);
  const failedScenes = scenes.filter(scene => scene.error !== undefined);

  return {
    successfulScenes,
    failedScenes,
    failureMessage: failedScenes.map(scene => `${scene.name}: ${scene.error}`).join('；'),
  };
}

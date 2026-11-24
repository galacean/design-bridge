export type ConvertStatus = 'idle' | 'done' | 'error';
export type OutputMode = 'scene' | 'full';

export interface LocateHistoryEntry {
  time: string;
  source: 'issue' | 'runtime';
  figmaNodeId?: string;
  sceneObjectId?: string;
  issueMessage: string;
}

export interface ScenePreviewObject {
  id: string;
  label: string;
  value: Record<string, unknown>;
}

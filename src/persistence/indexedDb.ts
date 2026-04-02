import { get, set } from 'idb-keyval';
import type { ProjectModel } from '../core/model/types';

const PROJECT_KEY = '3d-frame-project';
const CURRENT_SCHEMA_VERSION = 2;

export async function saveProject(model: ProjectModel): Promise<void> {
  await set(PROJECT_KEY, {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    model,
  });
}

export async function loadProject(): Promise<ProjectModel | null> {
  const data = await get(PROJECT_KEY);
  if (data && typeof data === 'object' && 'model' in data) {
    const stored = data as { schemaVersion?: number; model: ProjectModel };
    // Only load schema version 2+ (3D); discard legacy 2D data
    if (stored.schemaVersion && stored.schemaVersion >= CURRENT_SCHEMA_VERSION) {
      return stored.model;
    }
  }
  return null;
}

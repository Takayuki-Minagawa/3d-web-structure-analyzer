import { get, set, setMany } from 'idb-keyval';
import type { ProjectModel } from '../core/model/types';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  parseProjectFile,
  type ProjectFileImportResult,
} from '../io/projectFileParser';

const PROJECT_KEY = '3d-frame-project';
const BACKUPS_KEY = `${PROJECT_KEY}-backups`;
const CORRUPT_KEY = `${PROJECT_KEY}-corrupt`;
const MAX_BACKUPS = 3;
let writeQueue: Promise<void> = Promise.resolve();

export async function saveProject(model: ProjectModel): Promise<void> {
  const file = {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    model,
  };
  // Validate before storage, and serialize writes so an older slow write cannot
  // replace a newer model. setMany commits the current file and history atomically.
  const normalized = parseProjectFile(file).model;
  const operation = writeQueue.catch(() => undefined).then(async () => {
    const previous = await get<unknown>(PROJECT_KEY);
    const storedBackups = await get<unknown>(BACKUPS_KEY);
    const backups: unknown[] = Array.isArray(storedBackups) ? [...storedBackups] : [];
    const entries: [IDBValidKey, unknown][] = [];
    if (previous != null) {
      try {
        const parsed = parseProjectFile(previous);
        if (JSON.stringify(parsed.model) !== JSON.stringify(normalized)) backups.unshift(previous);
      } catch {
        entries.push([CORRUPT_KEY, { savedAt: new Date().toISOString(), data: previous }]);
      }
    }
    entries.push([BACKUPS_KEY, backups.slice(0, MAX_BACKUPS)], [PROJECT_KEY, file]);
    await setMany(entries);
  });
  writeQueue = operation;
  await operation;
}

/** Load, validate, and migrate the autosave while retaining migration warnings. */
export async function loadProjectWithReport(): Promise<ProjectFileImportResult | null> {
  const data = await get(PROJECT_KEY);
  if (data == null) return null;
  try {
    return parseProjectFile(data);
  } catch (error) {
    // Preserve the original bytes/object before attempting a known-good generation.
    // If quarantine itself fails, leave autosave paused and keep the current key.
    await set(CORRUPT_KEY, { savedAt: new Date().toISOString(), data });
    const backups = await get<unknown>(BACKUPS_KEY);
    for (const backup of Array.isArray(backups) ? backups : []) {
      try {
        const recovered = parseProjectFile(backup);
        recovered.warnings.push({
          code: 'AUTOSAVE_BACKUP_RECOVERED',
          message: '自動保存が破損していたため、直前の正常な世代を復元しました。破損データは別キーへ退避しています。',
        });
        return recovered;
      } catch { /* Try the next older generation. */ }
    }
    throw error;
  }
}

/** Compatibility wrapper for callers that only need the restored model. */
export async function loadProject(): Promise<ProjectModel | null> {
  return (await loadProjectWithReport())?.model ?? null;
}

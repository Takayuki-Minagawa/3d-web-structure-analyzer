import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCantileverTemplate } from '../../core/model/generators';
import { createAutosaveController, type AutosaveStatus } from '../../persistence/autosaveController';
import { loadProjectWithReport, saveProject } from '../../persistence/indexedDb';
import { get, setMany } from 'idb-keyval';

const storage = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => structuredClone(storage.get(key))),
  set: vi.fn(async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); }),
  setMany: vi.fn(async (entries: [string, unknown][]) => {
    for (const [key, value] of entries) storage.set(key, structuredClone(value));
  }),
}));

beforeEach(() => { storage.clear(); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('autosave restoration and failures', () => {
  it('never writes the startup model before a delayed restore, and saves only the restored model', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const controller = createAutosaveController(save, () => undefined);
    controller.update(generateCantileverTemplate({ title: 'Startup' }));
    await vi.advanceTimersByTimeAsync(5000);
    await controller.flush();
    expect(save).not.toHaveBeenCalled();
    controller.restored();
    const restored = generateCantileverTemplate({ title: 'Recovered' });
    controller.update(restored);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledExactlyOnceWith(restored);
    controller.dispose();
  });
  it('serializes slow writes and flushes the newest pending model', async () => {
    let finish: () => void = () => undefined;
    const first = new Promise<void>((resolve) => { finish = resolve; });
    const save = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const controller = createAutosaveController(save, () => undefined);
    controller.restored();
    controller.update(generateCantileverTemplate({ title: 'Old' }));
    const flushed = controller.flush();
    const latest = generateCantileverTemplate({ title: 'Latest' });
    controller.update(latest);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await flushed;
    expect(save).toHaveBeenLastCalledWith(latest);
    expect(controller.hasPending()).toBe(false);
    controller.dispose();
  });
  it('retains failed data, reports the error and retries without claiming success early', async () => {
    const statuses: AutosaveStatus[] = [];
    const save = vi.fn().mockRejectedValueOnce(new Error('QuotaExceededError')).mockResolvedValue(undefined);
    const controller = createAutosaveController(save, (s) => statuses.push(s));
    controller.restored();
    controller.update(generateCantileverTemplate());
    await controller.flush();
    expect(statuses[statuses.length - 1]).toMatchObject({ phase: 'error', error: 'QuotaExceededError' });
    expect(controller.hasPending()).toBe(true);
    await controller.retry();
    expect(statuses[statuses.length - 1]).toMatchObject({ phase: 'saved' });
    expect(statuses[statuses.length - 1]?.lastSavedAt).toBeTruthy();
    controller.dispose();
  });
  it('keeps three prior generations and quarantines a corrupt current file before recovery', async () => {
    for (const title of ['One', 'Two', 'Three', 'Four']) await saveProject(generateCantileverTemplate({ title }));
    expect((storage.get('3d-frame-project-backups') as unknown[])).toHaveLength(3);
    storage.set('3d-frame-project', { invalid: 'original' });
    const recovered = await loadProjectWithReport();
    expect(recovered?.model.title).toBe('Three');
    expect(recovered?.warnings.some((item) => item.code === 'AUTOSAVE_BACKUP_RECOVERED')).toBe(true);
    expect(storage.get('3d-frame-project-corrupt')).toMatchObject({ data: { invalid: 'original' } });
  });
  it('does not consume backup generations on unchanged saves with normalized defaults', async () => {
    const first = generateCantileverTemplate({ title: 'First' });
    for (let i = 0; i < 4; i++) await saveProject(first);
    expect(storage.get('3d-frame-project-backups')).toEqual([]);
    const second = generateCantileverTemplate({ title: 'Second' });
    for (let i = 0; i < 4; i++) await saveProject(second);
    expect((storage.get('3d-frame-project-backups') as unknown[])).toHaveLength(1);
  });
  it('propagates read denial and atomic write failure, preserving the previous current file', async () => {
    vi.mocked(get).mockRejectedValueOnce(new Error('SecurityError'));
    await expect(loadProjectWithReport()).rejects.toThrow('SecurityError');
    await saveProject(generateCantileverTemplate({ title: 'Safe' }));
    vi.mocked(setMany).mockRejectedValueOnce(new Error('QuotaExceededError'));
    await expect(saveProject(generateCantileverTemplate({ title: 'Unsaved' }))).rejects.toThrow('QuotaExceededError');
    expect((await loadProjectWithReport())?.model.title).toBe('Safe');
  });
  it('retains corrupt data even when no valid generation is available', async () => {
    storage.set('3d-frame-project', 'broken');
    await expect(loadProjectWithReport()).rejects.toThrow();
    expect(storage.get('3d-frame-project')).toBe('broken');
    expect(storage.get('3d-frame-project-corrupt')).toMatchObject({ data: 'broken' });
  });
});

import { freshData, defaultSettings, type StoreData, type TaskRecord } from './model';
import { SerialGate } from './reconcile';
export class TaskStore {
  data: StoreData = freshData(); private saves = new SerialGate();
  constructor(private persist: (data: StoreData) => Promise<void>) {}
  load(raw: unknown) {
    if (!raw) return;
    if (typeof raw !== 'object' || (raw as StoreData).version !== 1) throw new Error('Unsupported Freedom Tasks data version. Data was left untouched.');
    const data = raw as StoreData;
    if (!data.tasks || !Array.isArray(data.knownRemote) || !Array.isArray(data.initializedCalendars)) throw new Error('Freedom Tasks data needs repair. Data was left untouched.');
    this.data = { ...data, settings: { ...defaultSettings, ...data.settings } };
  }
  save(): Promise<void> {
    const snapshot = structuredClone(this.data);
    return this.saves.run(() => this.persist(snapshot));
  }
  records(): TaskRecord[] { return Object.values(this.data.tasks); }
  rename(oldPath: string, newPath: string) {
    for (const task of this.records()) {
      const path = task.locator.sourcePath;
      if (path === oldPath || path.startsWith(`${oldPath}/`)) task.locator.sourcePath = newPath + path.slice(oldPath.length);
    }
  }
}

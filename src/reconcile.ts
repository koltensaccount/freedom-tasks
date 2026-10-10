import { fields, type Snapshot, type Conflict, type TaskRecord } from './model';
export function threeWay(base: Snapshot, local: Snapshot, remote: Snapshot): { merged: Snapshot; conflicts: Conflict[] } {
  const merged = { ...base }; const conflicts: Conflict[] = [];
  for (const field of fields) {
    const b = base[field], l = local[field], r = remote[field];
    if (l === r) Object.assign(merged, { [field]: l });
    else if (l === b) Object.assign(merged, { [field]: r });
    else if (r === b) Object.assign(merged, { [field]: l });
    else { conflicts.push({ field, base: b, local: l, remote: r }); Object.assign(merged, { [field]: l }); }
  }
  return { merged, conflicts };
}
export function deletionDecision(task: TaskRecord, noteExists: boolean, found: boolean, now: number, grace = 30_000) {
  if (!noteExists) return 'orphan' as const;
  if (found) return 'keep' as const;
  if (task.state !== 'active' || task.conflicts.length) return 'repair' as const;
  return task.missingSince === undefined || now - task.missingSince < grace ? 'wait' as const : 'deleteRemote' as const;
}
export class SerialGate {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work); this.tail = next.catch(() => undefined); return next;
  }
}
export class SyncGate {
  private flight: Promise<void> | null = null;
  run(work: () => Promise<void>): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = Promise.resolve().then(work).finally(() => { this.flight = null; }); return this.flight;
  }
}
export class WriteGuard {
  private paths = new Set<string>();
  has(path: string) { return this.paths.has(path); }
  async run<T>(path: string, work: () => Promise<T>): Promise<T> {
    this.paths.add(path); try { return await work(); } finally { this.paths.delete(path); }
  }
}

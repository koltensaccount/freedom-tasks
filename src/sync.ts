import { capture, visibleTitle, hasMarkup, parseTasks } from './markdown';
import { threeWay, deletionDecision, SerialGate, SyncGate } from './reconcile';
import { remoteKey, fields, type Snapshot, type TaskRecord, type Field } from './model';
import type { TaskStore } from './store';
import type { TaskIO } from './task-io';
import type { DailyNoteInbox } from './inbox';
import type { FcrBridge, RemoteTask } from './fcr';
import type { SourceLinkService } from './source-link';
const same = (a: Snapshot, b: Snapshot) => fields.every(field => a[field] === b[field]);
export class SyncEngine {
  private operations = new SerialGate(); private syncGate = new SyncGate();
  busy = false; lastError = ''; private stopped = false;
  constructor(public store: TaskStore, private bridge: FcrBridge, public io: TaskIO,
    private inbox: DailyNoteInbox, private links: SourceLinkService,
    private changed: () => void, private followup: (delay: number) => void) {}
  stop() { this.stopped = true; }
  private match(record: TaskRecord, remotes: RemoteTask[]): RemoteTask | null {
    if (record.local.calendarId !== record.calendarId && remotes.filter(r => r.uid === record.uid).length > 1)
      throw new Error('Calendar move is only partially complete. Repair the duplicate UID in Full Calendar before continuing.');
    const exact = remotes.filter(r => r.uid === record.uid && r.calendarId === record.calendarId);
    const candidates = exact.length ? exact : remotes.filter(r => r.uid === record.uid);
    if (candidates.length > 1) throw new Error('Remote task identity is ambiguous; repair is required.');
    return candidates[0] || null;
  }
  sync(refresh = false): Promise<void> {
    return this.syncGate.run(() => this.operations.run(async () => {
      if (this.stopped) return;
      this.busy = true; this.lastError = ''; this.changed();
      try {
        if (refresh) { this.bridge.refresh(this.store.data.settings.managed); this.followup(3000); }
        const remotes = this.bridge.read(this.store.data.settings.managed);
        const errors: string[] = [];
        for (const record of this.store.records()) {
          if (this.stopped) return;
          if (!this.store.data.settings.managed.includes(record.calendarId)) continue;
          try { await this.reconcile(record, remotes); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
        }
        // Imported records and detached mappings take precedence over the remote baseline.
        for (const remote of remotes) {
          if (this.stopped) return;
          const key = remoteKey(remote.calendarId, remote.uid);
          const mapped = this.store.records().some(r => r.uid === remote.uid && (r.calendarId === remote.calendarId || r.local.calendarId === remote.calendarId || remotes.filter(t => t.uid === r.uid).length === 1));
          if (mapped || this.store.data.knownRemote.includes(key)) continue;
          if (!this.store.data.initializedCalendars.includes(remote.calendarId)) continue;
          try { await this.inbox.insert(remote); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); continue; }
          this.remember(key); await this.store.save();
        }
        if (errors.length) throw new Error([...new Set(errors)].join(' '));
        this.store.data.lastSync = Date.now(); await this.store.save();
      } catch (error) { this.lastError = error instanceof Error ? error.message : String(error); throw error; }
      finally { this.busy = false; this.changed(); }
    }));
  }
  private remember(key: string) { if (!this.store.data.knownRemote.includes(key)) this.store.data.knownRemote.push(key); }
  async initializeCalendars(importExisting: boolean): Promise<void> {
    return this.operations.run(async () => {
      const calendars = [...this.store.data.settings.managed]; const remotes = this.bridge.read(calendars);
      for (const remote of remotes) {
        const key = remoteKey(remote.calendarId, remote.uid);
        if (importExisting && !remote.snapshot.completed && !this.store.records().some(r => r.uid === remote.uid && r.calendarId === remote.calendarId)) await this.inbox.insert(remote);
        this.remember(key);
      }
      for (const id of calendars) if (!this.store.data.initializedCalendars.includes(id)) this.store.data.initializedCalendars.push(id);
      await this.store.save(); this.changed();
    });
  }
  private async reconcile(record: TaskRecord, remotes: RemoteTask[]) {
    let remote: RemoteTask | null;
    try { remote = this.match(record, remotes); } catch (error) { record.state = 'needsRepair'; await this.store.save(); throw error; }
    if (record.state === 'pendingCreate' && !remote) { record.detachedReason = 'Creation needs confirmation'; await this.store.save(); return; }
    if (!remote) {
      if (record.state !== 'orphaned' && record.state !== 'pendingImport') {
        record.state = 'detached'; record.detachedReason = 'Remote item is unavailable or no longer scheduled';
      }
      await this.store.save(); return; // No Markdown or remote deletion for remote disappearance.
    }
    this.remember(remoteKey(remote.calendarId, remote.uid));
    if (record.deletionIntent) {
      if (record.deletionIntentReason === 'localMissing') {
        const check = await this.io.locate(record);
        if (check.kind !== 'missing') {
          record.deletionIntent = false; record.deletionIntentReason = undefined;
          record.state = check.kind === 'found' ? 'active' : check.kind === 'orphaned' ? 'orphaned' : 'needsRepair';
          record.missingSince = undefined; await this.store.save();
          if (check.kind !== 'found') return;
        }
      }
    }
    if (record.deletionIntent) {
      await this.bridge.remove(remote); record.state = 'detached'; record.deletionIntent = false;
      record.deletionIntentReason = undefined;
      record.detachedReason = 'Removed from calendar'; await this.store.save(); return;
    }
    const found = await this.io.locate(record);
    if (record.state === 'pendingImport' && found.kind !== 'found') {
      record.state = 'needsRepair'; record.detachedReason = 'Interrupted inbox insertion'; await this.store.save(); return;
    }
    if (found.kind === 'orphaned') { record.state = 'orphaned'; await this.store.save(); return; }
    if (found.kind === 'ambiguous') { record.state = 'needsRepair'; await this.store.save(); return; }
    if (found.kind !== 'found') {
      const decision = deletionDecision(record, true, false, Date.now());
      if (decision === 'deleteRemote') {
        record.deletionIntent = true; record.deletionIntentReason = 'localMissing'; await this.store.save(); await this.bridge.remove(remote);
        record.state = 'detached'; record.deletionIntent = false; record.deletionIntentReason = undefined; record.detachedReason = 'Local task line removed'; await this.store.save();
      } else if (decision === 'wait') {
        record.missingSince ??= Date.now(); await this.store.save(); this.followup(31_000);
      } else { record.state = 'needsRepair'; await this.store.save(); }
      return;
    }
    // Relocation cannot claim a checkbox already assigned to another record.
    if (this.store.records().some(other => other.id !== record.id && other.locator.sourcePath === found.path && other.locator.lineHint === found.task.line && other.state !== 'detached')) {
      record.state = 'needsRepair'; await this.store.save(); return;
    }
    record.locator = capture(found.path, found.content, found.task); record.missingSince = undefined;
    const local: Snapshot = { ...record.local, title: visibleTitle(found.task.title), completed: found.task.completed };
    const { merged, conflicts } = threeWay(record.baseline, local, remote.snapshot);
    if (hasMarkup(found.task.title) && merged.title !== local.title && !conflicts.some(c => c.field === 'title')) {
      conflicts.push({ field: 'title', base: record.baseline.title, local: found.task.title, remote: remote.snapshot.title }); merged.title = local.title;
    }
    if (hasMarkup(found.task.title)) for (const conflict of conflicts) if (conflict.field === 'title') conflict.local = found.task.title;
    // Preserve existing RRULE; v1 never changes recurring task placement/completion.
    if (remote.recurring) {
      for (const field of fields) {
        if (local[field] !== remote.snapshot[field] && local[field] !== record.baseline[field] && !conflicts.some(c => c.field === field))
          conflicts.push({ field, base: record.baseline[field], local: local[field], remote: remote.snapshot[field] });
        Object.assign(merged, { [field]: remote.snapshot[field] });
      }
    }
    const blocked = new Set(conflicts.map(c => c.field));
    const targetRemote = { ...remote.snapshot }; const targetLocal = { ...local };
    for (const field of fields) if (!blocked.has(field)) {
      Object.assign(targetRemote, { [field]: merged[field] }); Object.assign(targetLocal, { [field]: merged[field] });
    }
    record.conflicts = conflicts;
    // Record conflict evidence before any field mutation.
    await this.store.save();
    if (!same(targetRemote, remote.snapshot)) remote = await this.bridge.update(remote, remote.snapshot, targetRemote);
    if (targetLocal.title !== local.title || targetLocal.completed !== local.completed) {
      const title = targetLocal.title === local.title ? found.task.title : targetLocal.title;
      await this.io.write(record, record.locator, local, { title, completed: targetLocal.completed });
    }
    for (const field of fields) if (!blocked.has(field)) Object.assign(record.baseline, { [field]: remote.snapshot[field] });
    record.local = targetLocal; record.calendarId = remote.calendarId; record.eventId = remote.id;
    record.state = 'active'; record.detachedReason = undefined; record.lastSeenAt = Date.now();
    await this.store.save();
  }
  schedule(path: string, line: number, values: { date: string; time: string | null; calendarId: string }): Promise<string> {
    return this.operations.run(async () => {
      if (!this.store.data.initializedCalendars.includes(values.calendarId)) throw new Error('Finish calendar setup before scheduling.');
      const file = this.io.file(path); if (!file) throw new Error('Source note is missing.');
      const content = await this.io.read(path);
      const markdown = parseTasks(content).find(task => task.line === line); if (!markdown) throw new Error('Place the cursor on a Markdown checkbox.');
      const associated: TaskRecord[] = [];
      for (const candidate of this.store.records().filter(t => t.locator.sourcePath === path)) {
        const located = await this.io.locate(candidate);
        if (located.kind === 'ambiguous' && (candidate.locator.lineHint === line || candidate.locator.title === markdown.title)) throw new Error('Repair the ambiguous existing mapping before scheduling another task here.');
        if (located.kind === 'found' && located.task.line === line) associated.push(candidate);
      }
      if (associated.length > 1) throw new Error('This task needs identity repair.');
      const existing = associated[0];
      if (existing) {
        if (existing.state !== 'active') throw new Error('This mapped task is detached or needs repair. Use repair before creating another calendar item.');
        existing.local = { ...existing.local, ...values }; await this.store.save();
        await this.reconcile(existing, this.bridge.read(this.store.data.settings.managed)); this.changed(); return existing.id;
      }
      const snapshot: Snapshot = { title: visibleTitle(markdown.title), completed: markdown.completed, ...values };
      const record: TaskRecord = { id: crypto.randomUUID(), uid: crypto.randomUUID(), locator: capture(path, content, markdown),
        calendarId: values.calendarId, local: { ...snapshot }, baseline: { ...snapshot }, state: 'pendingCreate', conflicts: [], lastSeenAt: Date.now() };
      this.store.data.tasks[record.id] = record; await this.store.save();
      const remote = await this.bridge.create(snapshot, record.uid, `Obsidian source: ${this.links.uri(record.id)}`);
      record.eventId = remote.id; record.baseline = { ...remote.snapshot }; record.local = { ...remote.snapshot }; record.state = 'active';
      this.remember(remoteKey(remote.calendarId, remote.uid)); await this.store.save(); this.changed(); return record.id;
    });
  }
  remove(id: string): Promise<void> {
    return this.operations.run(async () => {
      const record = this.store.data.tasks[id]; if (!record) return;
      const remote = this.match(record, this.bridge.read(this.store.data.settings.managed));
      if (remote) { record.deletionIntent = true; record.deletionIntentReason = 'remove'; await this.store.save(); await this.bridge.remove(remote); }
      record.deletionIntent = false; record.deletionIntentReason = undefined; record.state = 'detached'; record.detachedReason = 'Removed from calendar';
      await this.store.save(); this.changed();
    });
  }
  resolve(id: string, field: Field, side: 'local' | 'remote'): Promise<void> {
    return this.operations.run(async () => {
      const record = this.store.data.tasks[id]; const conflict = record?.conflicts.find(c => c.field === field);
      if (!record || !conflict) return;
      const remote = this.match(record, this.bridge.read(this.store.data.settings.managed)); if (!remote) throw new Error('Reconnect the scheduled remote item before resolving.');
      const found = await this.io.locate(record); if (found.kind !== 'found') throw new Error('Repair the source checkbox before resolving.');
      if (remote.recurring && side === 'local') throw new Error('Existing recurring tasks are read-only in v1. Keep the calendar value.');
      const currentLocal = { ...record.local, title: visibleTitle(found.task.title), completed: found.task.completed };
      const evidenceLocal = field === 'title' && hasMarkup(found.task.title) ? found.task.title : currentLocal[field];
      if (remote.snapshot[field] !== conflict.remote || evidenceLocal !== conflict.local) throw new Error('This field changed since the conflict was shown. Sync again before resolving.');
      const chosen = side === 'local' ? conflict.local : conflict.remote;
      const nextRemote = { ...remote.snapshot, [field]: field === 'title' && side === 'local' ? visibleTitle(String(chosen)) : chosen } as Snapshot;
      if (nextRemote[field] !== remote.snapshot[field]) await this.bridge.update(remote, remote.snapshot, nextRemote);
      if (field === 'title' || field === 'completed') {
        await this.io.write(record, capture(found.path, found.content, found.task), currentLocal,
          { title: field === 'title' ? side === 'local' ? found.task.title : String(chosen) : found.task.title,
            completed: field === 'completed' ? Boolean(chosen) : found.task.completed });
      }
      Object.assign(record.local, { [field]: nextRemote[field] }); Object.assign(record.baseline, { [field]: nextRemote[field] });
      record.conflicts = record.conflicts.filter(c => c.field !== field); await this.store.save(); this.changed();
    });
  }
  relink(id: string, path: string, line: number): Promise<void> {
    return this.operations.run(async () => {
      const record = this.store.data.tasks[id]; const file = this.io.file(path); if (!record || !file) throw new Error('Choose an existing source task.');
      const content = await this.io.read(path); const task = parseTasks(content).find(t => t.line === line); if (!task) throw new Error('Place the cursor on the intended checkbox.');
      if (this.store.records().some(r => r.id !== id && r.locator.sourcePath === path && r.locator.lineHint === line)) throw new Error('That checkbox already has a mapping.');
      record.locator = capture(path, content, task); record.state = 'detached'; record.missingSince = undefined;
      await this.store.save(); this.changed();
    });
  }
  rename(oldPath: string, newPath: string) { return this.operations.run(async () => { this.store.rename(oldPath, newPath); await this.store.save(); this.changed(); }); }
  forget(id: string) { return this.operations.run(async () => { delete this.store.data.tasks[id]; await this.store.save(); this.changed(); }); }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { TFile } from './obsidian';
vi.mock('obsidian-daily-notes-interface', () => ({
  appHasDailyNotesPluginLoaded: vi.fn(() => false), getDailyNote: vi.fn(), getAllDailyNotes: vi.fn(() => ({})), createDailyNote: vi.fn(),
}));
import { appHasDailyNotesPluginLoaded, getDailyNote } from 'obsidian-daily-notes-interface';
import { TaskStore } from '../src/store';
import { FcrBridge, FCR_ID, type AuthorizedApi, type FcrEvent } from '../src/fcr';
import { TaskIO } from '../src/task-io';
import { WriteGuard } from '../src/reconcile';
import { DailyNoteInbox, planInsertion } from '../src/inbox';
import { SourceLinkService } from '../src/source-link';
import { SyncEngine } from '../src/sync';
import { parseTasks, capture } from '../src/markdown';
import { remoteKey, type Snapshot, type TaskRecord } from '../src/model';
class Vault {
  texts = new Map<string, string>(); files = new Map<string, TFile>(); writes = 0;
  set(path: string, text: string) { const file = this.files.get(path) || new TFile(path); this.files.set(path, file); this.texts.set(path, text); return file; }
  getName() { return 'Test Vault'; }
  getAbstractFileByPath(path: string) { return this.files.get(path) || null; }
  async read(file: TFile) { if (!this.texts.has(file.path)) throw new Error('missing'); return this.texts.get(file.path)!; }
  async process(file: TFile, processor: (s: string) => string) { const next = processor(await this.read(file)); this.writes++; this.set(file.path, next); return next; }
  async create(path: string, text: string) { if (this.files.has(path)) throw new Error('exists'); return this.set(path, text); }
  async createFolder() {}
}
const base: Snapshot = { title: 'Homework', completed: false, date: '2026-10-13', time: null, calendarId: 'school' };
function fixture() {
  const vault = new Vault(); const note = vault.set('Note.md', 'Before\n- [ ] Homework\nAfter');
  const remoteEvents = new Map<string, { event: FcrEvent; calendarId: string }>();
  const create = vi.fn(async (calendarId: string, event: FcrEvent) => { remoteEvents.set(`session-${event.uid}`, { event: { ...event }, calendarId }); return true; });
  const update = vi.fn(async (id: string, processor: (e: FcrEvent) => FcrEvent) => { const existing = remoteEvents.get(id); if (!existing) return false; existing.event = processor(existing.event); return true; });
  const remove = vi.fn(async (id: string) => { remoteEvents.delete(id); });
  const api: AuthorizedApi = {
    getEvents: ({ calendarIds }) => [...remoteEvents].filter(([, e]) => calendarIds?.includes(e.calendarId)).map(([id, e]) => ({ id, uid: e.event.uid, calendarId: e.calendarId })),
    getAllEvents: () => [{ id: 'school', events: [...remoteEvents].map(([id, e]) => ({ id, event: e.event })) }],
    getEventById: id => remoteEvents.get(id)?.event || null, getEventDetails: id => remoteEvents.get(id) || null,
    getCalendarSources: () => [{ id: 'school', name: 'School', type: 'caldavtasks', color: '#123456', password: 'secret' } as unknown as ReturnType<AuthorizedApi['getCalendarSources']>[0], { id: 'normal', name: 'Tasks', type: 'caldav' }],
    getProviderCapabilities: () => ({ canCreate: true, canEdit: true, canDelete: true }),
    createEvent: create, processEvent: update, deleteEvent: remove,
    moveEvent: async (id, calendarId, event) => { const entry = remoteEvents.get(id); if (entry) remoteEvents.set(id, { event: event || entry.event, calendarId }); },
    reloadProviderNow: vi.fn(), openCalendar: async () => {},
  };
  const app = { vault, plugins: { plugins: { [FCR_ID]: { api: { withToken: () => api, requestAccess: async () => 'issued' } } } } } as unknown as App;
  const saved: unknown[] = []; const store = new TaskStore(async data => { saved.push(structuredClone(data)); });
  store.data.settings.token = 'token'; store.data.settings.managed = ['school']; store.data.settings.defaultCalendar = 'school'; store.data.initializedCalendars = ['school'];
  const io = new TaskIO(app, new WriteGuard()); const bridge = new FcrBridge(app, () => store.data.settings.token);
  const inbox = new DailyNoteInbox(app, store, io.guard); const links = new SourceLinkService(app, store, io);
  const followup = vi.fn(); const engine = new SyncEngine(store, bridge, io, inbox, links, vi.fn(), followup);
  const map = (uid = 'uid-one'): TaskRecord => {
    const text = vault.texts.get(note.path)!;
    const record: TaskRecord = { id: `freedom-${uid}`, uid, eventId: `session-${uid}`, calendarId: 'school', locator: capture(note.path, text, parseTasks(text)[0]), local: { ...base }, baseline: { ...base }, state: 'active', conflicts: [], lastSeenAt: Date.now() };
    store.data.tasks[record.id] = record; store.data.knownRemote.push(remoteKey('school', uid)); return record;
  };
  const remote = (uid = 'uid-one', values: Partial<FcrEvent> = {}) => remoteEvents.set(`session-${uid}`, { calendarId: 'school', event: { type: 'single', title: 'Homework', date: base.date, allDay: true, uid, completed: false, ...values } });
  return { vault, store, io, bridge, inbox, engine, remoteEvents, api, map, remote, create, update, remove, saved, followup };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(appHasDailyNotesPluginLoaded).mockReturnValue(false); });
describe('Daily Note insertion', () => {
  it('inserts into existing Tasks heading before the next section', () => {
    const result = planInsertion('## Tasks\n- [ ] Existing\n\n## Journal\nText', 'Tasks', 'New');
    expect(result.content).toBe('## Tasks\n- [ ] Existing\n- [ ] New\n\n## Journal\nText');
  });
  it('appends a missing heading while preserving frontmatter/template content', () => {
    const content = '---\ndate: 2026-10-10\n---\n# Daily\nTemplate text\n';
    expect(planInsertion(content, 'Tasks', 'New').content).toBe(`${content}\n## Tasks\n- [ ] New\n`);
  });
  it('does not mistake code examples for the incoming heading', () => {
    expect(planInsertion('```md\n## Tasks\n```', 'Tasks', 'New').content).toContain('```\n\n## Tasks\n- [ ] New');
  });
  it('preserves CRLF', () => expect(planInsertion('## Tasks\r\n', 'Tasks', 'New').content).toBe('## Tasks\r\n- [ ] New\r\n'));
  it('uses today’s configured note even for a future due date', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T12:00:00'));
    const f = fixture(); const today = f.vault.set('Daily/2026-10-10.md', 'Template\n');
    vi.mocked(appHasDailyNotesPluginLoaded).mockReturnValue(true); vi.mocked(getDailyNote).mockReturnValue(today as unknown as ReturnType<typeof getDailyNote>);
    f.remote('new', { date: '2026-10-20' }); await f.engine.sync();
    expect(f.vault.texts.get(today.path)).toContain('- [ ] Homework'); expect([...f.vault.files.keys()]).not.toContain('Daily/2026-10-20.md');
    expect(vi.mocked(getDailyNote).mock.calls[0][0].format('YYYY-MM-DD')).toBe('2026-10-10'); vi.useRealTimers();
  });
});
describe('scheduled-only reconciliation', () => {
  it('remote disappearance keeps the exact Markdown and a detached tombstone', async () => {
    const f = fixture(); const r = f.map(); const original = f.vault.texts.get('Note.md'); await f.engine.sync();
    expect(f.vault.texts.get('Note.md')).toBe(original); expect(r.state).toBe('detached'); expect(r.uid).toBe('uid-one'); expect(r.baseline).toEqual(base); expect(f.remove).not.toHaveBeenCalled();
  });
  it('reconnects the same UID without creating a Daily Note duplicate', async () => {
    const f = fixture(); const r = f.map(); await f.engine.sync(); f.remote('uid-one', { date: '2026-10-20' }); await f.engine.sync();
    expect(r.state).toBe('active'); expect(r.local.date).toBe('2026-10-20'); expect(f.store.records()).toHaveLength(1); expect(f.vault.files.size).toBe(1);
  });
  it('retains baseline for local changes made while detached', async () => {
    const f = fixture(); const r = f.map(); await f.engine.sync(); f.vault.set('Note.md', 'Before\n- [x] Homework\nAfter'); f.remote(); await f.engine.sync();
    expect(f.remoteEvents.get('session-uid-one')?.event.completed).toBe(true); expect(r.baseline.completed).toBe(true);
  });
  it('ignores undated tasks, then imports once when they become scheduled', async () => {
    const f = fixture(); f.remote('new', { date: undefined }); await f.engine.sync(); expect(f.store.records()).toHaveLength(0);
    f.remote('new', { date: '2026-10-20' }); await f.engine.sync(); await f.engine.sync();
    expect(f.store.records()).toHaveLength(1); expect(parseTasks(f.vault.texts.get('Freedom Tasks Inbox.md')!)).toHaveLength(1);
  });
  it('imports a newly eligible completed task with its checked state intact', async () => {
    const f = fixture(); f.remote('new', { completed: true }); await f.engine.sync();
    expect(f.vault.texts.get('Freedom Tasks Inbox.md')).toContain('- [x] Homework'); expect(f.store.records()[0].baseline.completed).toBe(true);
  });
  it('existing remote baseline prevents first-run historical imports', async () => {
    const f = fixture(); f.store.data.initializedCalendars = []; f.remote('old'); await f.engine.initializeCalendars(false); await f.engine.sync();
    expect(f.store.records()).toHaveLength(0); expect(f.vault.files.size).toBe(1);
  });
  it('explicit import imports incomplete tasks once', async () => {
    const f = fixture(); f.remote('old'); f.remote('done', { completed: true }); await f.engine.initializeCalendars(true); await f.engine.initializeCalendars(true);
    expect(f.store.records()).toHaveLength(1); expect(f.store.records()[0].uid).toBe('old');
  });
  it('merges a local title with a remote date and preserves remote description', async () => {
    const f = fixture(); const r = f.map(); f.vault.set('Note.md', 'Before\n- [ ] Chapter four\nAfter'); f.remote('uid-one', { date: '2026-10-20', description: 'Keep remote notes' }); await f.engine.sync();
    expect(r.local.title).toBe('Chapter four'); expect(r.local.date).toBe('2026-10-20'); expect(f.remoteEvents.get('session-uid-one')?.event.description).toBe('Keep remote notes'); expect(r.conflicts).toEqual([]);
  });
  it('remote completion updates only the mapped checkbox', async () => {
    const f = fixture(); f.map(); f.remote('uid-one', { completed: true }); await f.engine.sync();
    expect(f.vault.texts.get('Note.md')).toBe('Before\n- [x] Homework\nAfter');
  });
  it('does not issue writes on converged state or feedback reconciliation', async () => {
    const f = fixture(); f.map(); f.remote(); await f.engine.sync(); await f.engine.sync();
    expect(f.update).not.toHaveBeenCalled(); expect(f.vault.writes).toBe(0);
  });
  it('holds a same-field conflict and resolves only after explicit choice', async () => {
    const f = fixture(); const r = f.map(); f.vault.set('Note.md', 'Before\n- [ ] Local title\nAfter'); f.remote('uid-one', { title: 'Remote title' }); await f.engine.sync();
    expect(r.conflicts).toHaveLength(1); expect(f.update).not.toHaveBeenCalled(); expect(f.vault.texts.get('Note.md')).toContain('Local title');
    await f.engine.resolve(r.id, 'title', 'remote'); expect(r.conflicts).toEqual([]); expect(f.vault.texts.get('Note.md')).toContain('Remote title');
  });
  it('treats remote rewrites of Markdown markup as a conflict', async () => {
    const f = fixture(); f.vault.set('Note.md', 'Before\n- [ ] Review [[Chapter 4]]\nAfter'); const r = f.map();
    r.local.title = r.baseline.title = 'Review Chapter 4'; f.remote('uid-one', { title: 'Review chapter five' }); await f.engine.sync();
    expect(r.conflicts[0].field).toBe('title'); expect(f.vault.texts.get('Note.md')).toContain('[[Chapter 4]]');
    await f.engine.resolve(r.id, 'title', 'local'); expect(f.vault.texts.get('Note.md')).toContain('[[Chapter 4]]');
  });
  it('local deletion only deletes remotely after a second confirmed absence and grace', async () => {
    const f = fixture(); const r = f.map(); f.remote(); f.vault.set('Note.md', 'Before\nAfter'); await f.engine.sync();
    expect(f.remove).not.toHaveBeenCalled(); r.missingSince = Date.now() - 31_000; await f.engine.sync(); expect(f.remove).toHaveBeenCalledTimes(1); expect(r.state).toBe('detached');
  });
  it('cut/move to a recently modified note relinks rather than deleting', async () => {
    const f = fixture(); const r = f.map(); f.remote(); f.vault.set('Note.md', 'Before\nAfter'); await f.engine.sync();
    f.vault.set('New.md', 'Before\n- [ ] Homework\nAfter'); f.io.modified('New.md'); await f.engine.sync();
    expect(r.locator.sourcePath).toBe('New.md'); expect(f.remove).not.toHaveBeenCalled();
  });
  it('a plausible cross-note move without context enters repair instead of deletion', async () => {
    const f = fixture(); const r = f.map(); f.remote(); f.vault.set('Note.md', 'Before\nAfter');
    f.vault.set('New.md', '- [ ] Homework'); f.io.modified('New.md'); r.missingSince = Date.now() - 31_000;
    await f.engine.sync(); expect(r.state).toBe('needsRepair'); expect(f.remove).not.toHaveBeenCalled();
  });
  it('whole-note deletion never causes remote deletion', async () => {
    const f = fixture(); const r = f.map(); f.remote(); f.vault.files.delete('Note.md'); f.vault.texts.delete('Note.md'); await f.engine.sync();
    expect(r.state).toBe('orphaned'); expect(f.remove).not.toHaveBeenCalled();
  });
  it('maps duplicate-title checkboxes independently during explicit scheduling', async () => {
    const f = fixture(); f.vault.set('Note.md', 'One\n- [ ] Study\nA\n\nTwo\n- [ ] Study\nB');
    const a = await f.engine.schedule('Note.md', 1, { date: base.date, time: null, calendarId: 'school' });
    const b = await f.engine.schedule('Note.md', 5, { date: base.date, time: null, calendarId: 'school' });
    expect(a).not.toBe(b); expect(f.store.data.tasks[a].uid).not.toBe(f.store.data.tasks[b].uid); expect(f.create).toHaveBeenCalledTimes(2);
  });
  it('blocks new creation when a checkbox could belong to an ambiguous existing mapping', async () => {
    const f = fixture(); f.vault.set('Note.md', 'First\n- [ ] Homework\nA\nSecond\n- [ ] Homework\nB'); f.map(); f.remote();
    f.vault.set('Note.md', '- [ ] Homework\n- [ ] Homework');
    await expect(f.engine.schedule('Note.md', 0, { date: base.date, time: null, calendarId: 'school' })).rejects.toThrow('ambiguous'); expect(f.create).not.toHaveBeenCalled();
  });
  it('keeps partially moved duplicate UIDs in repair without importing a second checkbox', async () => {
    const f = fixture(); const r = f.map(); f.remote(); r.local.calendarId = 'other';
    f.api.getCalendarSources = () => [{ id: 'school', name: 'School', type: 'caldavtasks' }, { id: 'other', name: 'Other', type: 'caldavtasks' }];
    f.store.data.settings.managed.push('other'); f.store.data.initializedCalendars.push('other');
    f.remoteEvents.set('copy', { calendarId: 'other', event: { ...f.remoteEvents.get('session-uid-one')!.event } });
    await expect(f.engine.sync()).rejects.toThrow('partially'); expect(r.state).toBe('needsRepair'); expect(f.store.records()).toHaveLength(1); expect(f.vault.files.size).toBe(1);
  });
  it('persists pending creation intent before network creation and blocks automatic retries', async () => {
    const f = fixture(); f.create.mockImplementationOnce(async () => { expect((f.saved.at(-1) as typeof f.store.data).tasks).not.toEqual({}); return false; });
    await expect(f.engine.schedule('Note.md', 1, { date: base.date, time: null, calendarId: 'school' })).rejects.toThrow();
    await f.engine.sync(); expect(f.create).toHaveBeenCalledTimes(1); expect(f.store.records()[0].state).toBe('pendingCreate');
  });
  it('recovers persisted creation after a crash without a duplicate request', async () => {
    const f = fixture(); const r = f.map(); r.state = 'pendingCreate'; f.remote(); await f.engine.sync(); expect(r.state).toBe('active'); expect(f.create).not.toHaveBeenCalled();
  });
  it('interrupted inbox import never adds another checkbox automatically', async () => {
    const f = fixture(); const r = f.map(); r.state = 'pendingImport'; f.remote(); f.vault.set('Note.md', 'No checkbox'); await f.engine.sync(); await f.engine.sync();
    expect(r.state).toBe('needsRepair'); expect(f.store.records()).toHaveLength(1); expect(f.vault.files.size).toBe(1);
  });
  it('preserves recurring remote items without unsafe mutation', async () => {
    const f = fixture(); const r = f.map(); f.remote('uid-one', { type: 'rrule', startDate: base.date, rrule: 'FREQ=WEEKLY', isTask: true });
    f.vault.set('Note.md', 'Before\n- [x] Homework\nAfter'); await f.engine.sync();
    expect(f.update).not.toHaveBeenCalled(); expect(r.conflicts.some(c => c.field === 'completed')).toBe(true); expect(f.remoteEvents.get('session-uid-one')?.event.rrule).toBe('FREQ=WEEKLY');
  });
});
describe('bridge safety', () => {
  it('distinguishes dedicated providers and never retains credentials', () => {
    const f = fixture(); expect(f.bridge.calendars()).toEqual([{ id: 'school', name: 'School', color: '#123456' }]); expect(JSON.stringify(f.bridge.calendars())).not.toContain('secret');
  });
  it('requires unique UID identity rather than matching title/date', () => {
    const f = fixture(); f.remote(); f.remoteEvents.set('another', { calendarId: 'school', event: { ...f.remoteEvents.get('session-uid-one')!.event } }); expect(() => f.bridge.find('school', 'uid-one')).toThrow('Duplicate');
  });
  it('handles revoked authorization without reaching into internals', () => {
    const f = fixture(); f.store.data.settings.token = null; expect(f.bridge.connected()).toBe(false); expect(() => f.bridge.api()).toThrow('Authorize');
  });
});

import { describe, it, expect } from 'vitest';
import { parseTasks, capture, locate, replaceTask, visibleTitle } from '../src/markdown';
import { threeWay, deletionDecision, SyncGate, WriteGuard } from '../src/reconcile';
import { TaskStore } from '../src/store';
import { snapshotOf, patchOwned } from '../src/fcr';
import type { Snapshot, TaskRecord } from '../src/model';
const base: Snapshot = { title: 'Homework', completed: false, date: '2026-10-13', time: null, calendarId: 'school' };
const record = (): TaskRecord => ({ id: 'a', uid: 'uid-a', locator: capture('Note.md', '- [ ] Homework', parseTasks('- [ ] Homework')[0]), calendarId: 'school', local: { ...base }, baseline: { ...base }, state: 'active', lastSeenAt: 0, conflicts: [] });
describe('plain Markdown', () => {
  it('parses checked, unchecked, nested and duplicate titles without changing source', () => {
    const text = '- [ ] Study\n  - [x] Study\n\t* [X] Nested';
    expect(parseTasks(text).map(t => [t.title, t.completed])).toEqual([['Study', false], ['Study', true], ['Nested', true]]);
    expect(text).toBe('- [ ] Study\n  - [x] Study\n\t* [X] Nested');
  });
  it('ignores template frontmatter and fenced examples', () => {
    expect(parseTasks('---\n- [ ] property\n---\n```md\n- [ ] example\n```\n- [ ] real').map(t => t.title)).toEqual(['real']);
  });
  it('keeps Markdown link source while deriving visible summary', () => expect(visibleTitle('Review [[Chapter 4|the chapter]] and **notes**')).toBe('Review the chapter and notes'));
  it('does not accept newline injection during checkbox writing', () => {
    const task = record(); expect(() => replaceTask('- [ ] Homework', task.locator, 'Bad\n- [ ] Injected', false)).toThrow();
  });
});
describe('defensive location', () => {
  const original = 'Before\n- [ ] Study\nAfter\n'; const locator = capture('N.md', original, parseTasks(original)[0]);
  it('finds same line when only completion changes', () => expect(locate(original.replace('[ ]', '[x]'), locator).kind).toBe('found'));
  it('relocates within a note after an insertion', () => {
    const found = locate(`Introduction\n${original}`, locator); expect(found.kind).toBe('found'); if (found.kind === 'found') expect(found.task.line).toBe(2);
  });
  it('retains location when surrounding prose changes', () => expect(locate(original.replace('Before', 'New before').replace('After', 'New after'), locator).kind).toBe('found'));
  it('recognizes a title edit anchored by context', () => {
    const found = locate(original.replace('Study', 'Study chapter four'), locator); expect(found.kind).toBe('found');
    if (found.kind === 'found') expect(found.task.title).toBe('Study chapter four');
  });
  it('keeps two same-title tasks distinct through their contexts', () => {
    const text = 'First\n- [ ] Study\nA\n\nSecond\n- [ ] Study\nB';
    const locators = parseTasks(text).map(t => capture('N.md', text, t));
    const edited = `Heading\n${text}`;
    const found = locators.map(l => locate(edited, l));
    expect(found.every(r => r.kind === 'found')).toBe(true);
    expect(found.map(r => r.kind === 'found' ? r.task.line : -1)).toEqual([2, 6]);
  });
  it('never disambiguates duplicates using only line proximity', () => {
    const text = 'First\n- [ ] Study\nA\nSecond\n- [ ] Study\nB';
    const l = capture('N.md', text, parseTasks(text)[0]);
    expect(locate('- [ ] Study\n- [ ] Study', l).kind).toBe('ambiguous');
  });
  it('refuses a disappearing duplicate with no remaining context evidence', () => {
    const text = '- [ ] Study\n- [ ] Study'; const l = capture('N.md', text, parseTasks(text)[0]);
    expect(locate('- [ ] Study', l).kind).toBe('ambiguous');
  });
  it('enters repair instead of inferring deletion after both title and context change', () => {
    expect(locate('New before\n- [ ] Different title\nNew after', locator).kind).toBe('ambiguous');
  });
  it('writes only checkbox/title, preserving indentation, CRLF and unrelated text', () => {
    const text = 'Before\r\n  - [ ] Study\r\nAfter'; const l = capture('N.md', text, parseTasks(text)[0]);
    expect(replaceTask(text, l, 'Study chapter four', true)).toBe('Before\r\n  - [x] Study chapter four\r\nAfter');
  });
});
describe('field-level three-way comparison', () => {
  it('pushes local-only title', () => expect(threeWay(base, { ...base, title: 'Local' }, base)).toEqual({ merged: { ...base, title: 'Local' }, conflicts: [] }));
  it('pulls remote-only date', () => expect(threeWay(base, base, { ...base, date: '2026-10-15' }).merged.date).toBe('2026-10-15'));
  it('merges independent fields', () => {
    const result = threeWay(base, { ...base, title: 'Local' }, { ...base, date: '2026-10-15' });
    expect(result.merged).toEqual({ ...base, title: 'Local', date: '2026-10-15' }); expect(result.conflicts).toEqual([]);
  });
  it('accepts same-field convergence', () => expect(threeWay(base, { ...base, title: 'Same' }, { ...base, title: 'Same' }).conflicts).toEqual([]));
  it('records differing same-field edits without choosing remotely', () => {
    const result = threeWay(base, { ...base, title: 'Local' }, { ...base, title: 'Remote' });
    expect(result.conflicts).toEqual([{ field: 'title', base: 'Homework', local: 'Local', remote: 'Remote' }]);
  });
});
describe('deletion policy', () => {
  it('waits for cut/move relocation grace', () => { const r = record(); r.missingSince = 1000; expect(deletionDecision(r, true, false, 20_000)).toBe('wait'); });
  it('permits only confirmed missing local line after grace', () => { const r = record(); r.missingSince = 1000; expect(deletionDecision(r, true, false, 32_000)).toBe('deleteRemote'); });
  it('never mass-deletes after whole-note removal', () => expect(deletionDecision(record(), false, false, 100_000)).toBe('orphan'));
  it('does not remote-delete detached or conflicted mappings', () => { const r = record(); r.state = 'detached'; expect(deletionDecision(r, true, false, 100_000)).toBe('repair'); });
});
describe('public event model', () => {
  it('keeps date-only tasks time-free and omits undated tasks', () => {
    expect(snapshotOf({ type: 'single', title: 'A', date: '2026-10-20', allDay: true }, 'c')?.time).toBe(null);
    expect(snapshotOf({ type: 'single', title: 'A', allDay: true }, 'c')).toBe(null);
  });
  it('rejects invalid dates and incomplete timed events', () => {
    expect(snapshotOf({ type: 'single', title: 'A', date: '2026-02-30', allDay: true }, 'c')).toBe(null);
    expect(snapshotOf({ type: 'single', title: 'A', date: '2026-10-20', allDay: false }, 'c')).toBe(null);
  });
  it('patches owned fields while preserving description and typed metadata', () => {
    const event = { type: 'single' as const, title: 'A', uid: 'uid', date: '2026-10-13', allDay: true, description: 'Keep me', icalTask: { priority: 2, start: { value: '2026-10-13', allDay: true } }, custom: 'untouched' };
    const updated = patchOwned(event, { ...base, title: 'New' });
    expect(updated.description).toBe('Keep me'); expect(updated.icalTask).toEqual(event.icalTask); expect(updated.custom).toBe('untouched'); expect(updated.uid).toBe('uid');
  });
});
describe('gates and persistence', () => {
  it('joins concurrent reconciliation without overlapping work', async () => {
    const gate = new SyncGate(); let release!: () => void; let calls = 0;
    const work = () => { calls++; return new Promise<void>(resolve => { release = resolve; }); };
    const first = gate.run(work), second = gate.run(work); await Promise.resolve(); expect(calls).toBe(1); release(); await Promise.all([first, second]);
    await gate.run(async () => { calls++; }); expect(calls).toBe(2);
  });
  it('clears reentrancy protection after a failed write', async () => {
    const guard = new WriteGuard(); await expect(guard.run('N.md', async () => { expect(guard.has('N.md')).toBe(true); throw new Error('fail'); })).rejects.toThrow(); expect(guard.has('N.md')).toBe(false);
  });
  it('serializes immutable save snapshots and recovers after persistence failure', async () => {
    const writes: unknown[] = []; let fail = true;
    const store = new TaskStore(async data => { if (fail) { fail = false; throw new Error('disk'); } writes.push(data); });
    await expect(store.save()).rejects.toThrow(); store.data.settings.heading = 'First'; const a = store.save(); store.data.settings.heading = 'Second'; const b = store.save();
    await Promise.all([a, b]); expect(writes.map(d => (d as typeof store.data).settings.heading)).toEqual(['First', 'Second']);
  });
  it('refuses unknown schema versions', () => expect(() => new TaskStore(async () => {}).load({ version: 99 })).toThrow('Unsupported'));
  it('updates nested note paths without changing identity', () => {
    const store = new TaskStore(async () => {}); const r = record(); r.locator.sourcePath = 'Folder/Note.md'; store.data.tasks[r.id] = r;
    store.rename('Folder', 'School'); expect(r.locator.sourcePath).toBe('School/Note.md'); expect(r.uid).toBe('uid-a'); expect(r.id).toBe('a');
  });
});

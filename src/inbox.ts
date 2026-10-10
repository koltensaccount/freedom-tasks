import { TFile, normalizePath, moment, type App } from 'obsidian';
import { appHasDailyNotesPluginLoaded, getDailyNote, getAllDailyNotes, createDailyNote } from 'obsidian-daily-notes-interface';
import { parseTasks, capture } from './markdown';
import type { TaskStore } from './store';
import type { TaskRecord } from './model';
import type { RemoteTask } from './fcr';
import type { WriteGuard } from './reconcile';
export function planInsertion(content: string, heading: string, title: string, completed = false): { content: string; line: number } {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/); const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim();
  if (!cleanTitle) throw new Error('The remote task has an empty title.');
  let fence: string | null = null; let frontmatter = lines[0]?.trim() === '---'; let start = -1; let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (frontmatter) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(lines[i])) frontmatter = false; continue; }
    const marker = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1][0]; else if (fence === marker[1][0]) fence = null; continue; }
    if (fence) continue;
    if (start === -1 && lines[i].trim() === `## ${heading.trim()}`) start = i;
    else if (start !== -1 && /^#{1,2}\s/.test(lines[i])) { end = i; break; }
  }
  if (start === -1) {
    if (lines.length === 1 && lines[0] === '') lines.length = 0;
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`## ${heading.trim()}`, ''); end = lines.length;
  }
  while (end > 0 && lines[end - 1] === '') end--;
  lines.splice(end, 0, `- [${completed ? 'x' : ' '}] ${cleanTitle}`);
  if (end + 1 < lines.length && /^#{1,2}\s/.test(lines[end + 1])) lines.splice(end + 1, 0, '');
  return { content: lines.join(eol), line: end };
}
export class DailyNoteInbox {
  constructor(private app: App, private store: TaskStore, private guard: WriteGuard) {}
  async file(): Promise<TFile> {
    if (appHasDailyNotesPluginLoaded()) {
      const today = (moment as unknown as () => import('moment').Moment)(); // The user's runtime local date, never the remote due date.
      const file = getDailyNote(today, getAllDailyNotes()) || await createDailyNote(today);
      if (!file) throw new Error('Daily Notes could not create today’s note. Check its folder/template settings.'); return file;
    }
    const path = normalizePath(this.store.data.settings.fallbackPath.trim());
    if (!path.endsWith('.md') || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Choose a relative Markdown fallback inbox path.');
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    if (existing) throw new Error('The fallback inbox path is a folder.');
    const folder = path.slice(0, path.lastIndexOf('/'));
    if (path.includes('/') && folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    return this.app.vault.create(path, '');
  }
  async insert(remote: RemoteTask): Promise<TaskRecord> {
    const file = await this.file(); const before = await this.app.vault.read(file);
    const plan = planInsertion(before, this.store.data.settings.heading, remote.snapshot.title, remote.snapshot.completed);
    const markdown = parseTasks(plan.content).find(t => t.line === plan.line);
    if (!markdown) throw new Error('Could not prepare a safe Markdown insertion.');
    const record: TaskRecord = { id: crypto.randomUUID(), uid: remote.uid, eventId: remote.id,
      locator: capture(file.path, plan.content, markdown), calendarId: remote.calendarId,
      local: { ...remote.snapshot }, baseline: { ...remote.snapshot }, state: 'pendingImport', conflicts: [], lastSeenAt: Date.now() };
    // Persist intent first. An interrupted insertion is repaired, never automatically repeated.
    this.store.data.tasks[record.id] = record; await this.store.save();
    await this.guard.run(file.path, () => this.app.vault.process(file, current => {
      if (current !== before) throw new Error('The inbox changed before insertion. Sync again to repair this task.'); return plan.content;
    }));
    record.state = 'active'; await this.store.save(); return record;
  }
}

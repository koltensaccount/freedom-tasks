import { TFile, type App } from 'obsidian';
import { locate, capture, replaceTask, visibleTitle, parseTasks, type MarkdownTask } from './markdown';
import type { Locator, TaskRecord } from './model';
import type { WriteGuard } from './reconcile';
export class TaskIO {
  recent = new Map<string, number>();
  constructor(private app: App, public guard: WriteGuard) {}
  file(path: string): TFile | null { const file = this.app.vault.getAbstractFileByPath(path); return file instanceof TFile ? file : null; }
  async read(path: string): Promise<string> { const file = this.file(path); if (!file) throw new Error('Source note is missing.'); return this.app.vault.read(file); }
  modified(path: string) { if (!this.guard.has(path)) this.recent.set(path, Date.now()); }
  async locate(record: TaskRecord): Promise<{ kind: 'found'; task: MarkdownTask; content: string; path: string } | { kind: 'missing' | 'ambiguous' | 'orphaned' }> {
    const source = this.file(record.locator.sourcePath);
    if (!source) return { kind: 'orphaned' }; // Whole-note deletion is not task-line deletion.
    const content = await this.app.vault.read(source); const result = locate(content, record.locator);
    if (result.kind === 'found') return { ...result, content, path: source.path };
    if (result.kind === 'ambiguous') return result;
    const found: { task: MarkdownTask; content: string; path: string }[] = []; let uncertain = false;
    for (const [path, modified] of this.recent) {
      if (Date.now() - modified > 5 * 60_000) { this.recent.delete(path); continue; }
      if (path === source.path) continue;
      const file = this.file(path); if (!file || file.extension !== 'md') continue;
      const text = await this.app.vault.read(file);
      if (!parseTasks(text).some(task => task.title === record.locator.title)) continue;
      const moved = locate(text, { ...record.locator, lineHint: -1 });
      if (moved.kind === 'ambiguous') return { kind: 'ambiguous' };
      if (moved.kind === 'found') {
        const candidate = capture(path, text, moved.task);
        const contextMatches = record.locator.before.some(Boolean) && JSON.stringify(candidate.before) === JSON.stringify(record.locator.before) ||
          record.locator.after.some(Boolean) && JSON.stringify(candidate.after) === JSON.stringify(record.locator.after);
        if (contextMatches && moved.task.text === record.locator.sourceText) found.push({ task: moved.task, content: text, path });
        else uncertain = true;
      }
    }
    if (found.length > 1 || uncertain) return { kind: 'ambiguous' };
    if (found.length === 1) return { kind: 'found', ...found[0] };
    return { kind: 'missing' };
  }
  async write(record: TaskRecord, locator: Locator, expected: { title: string; completed: boolean }, next: { title: string; completed: boolean }): Promise<void> {
    const file = this.file(locator.sourcePath); if (!file) throw new Error('Source note is missing. Repair its mapping first.');
    let updatedLocator = locator;
    await this.guard.run(file.path, () => this.app.vault.process(file, content => {
      const found = locate(content, locator);
      if (found.kind !== 'found' || visibleTitle(found.task.title) !== expected.title || found.task.completed !== expected.completed) throw new Error('The checkbox changed during synchronization. No Markdown was overwritten.');
      const updated = replaceTask(content, locator, next.title, next.completed);
      const after = locate(updated, { ...locator, title: next.title });
      if (after.kind !== 'found') throw new Error('Could not verify the new checkbox location.');
      updatedLocator = capture(file.path, updated, after.task); return updated;
    }));
    record.locator = updatedLocator;
  }
}

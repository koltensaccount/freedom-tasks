import { Plugin, MarkdownView, Notice, TFile, type Modal } from 'obsidian';
import { TaskStore } from './store';
import { FcrBridge } from './fcr';
import { TaskIO } from './task-io';
import { WriteGuard } from './reconcile';
import { DailyNoteInbox } from './inbox';
import { SourceLinkService } from './source-link';
import { SyncEngine } from './sync';
import { taskEditorExtension, refreshTasks } from './editor';
import { TaskPopover, ConflictModal } from './ui';
import { FreedomSettingsTab } from './settings';
import { parseTasks } from './markdown';
export default class FreedomTasksPlugin extends Plugin {
  store!: TaskStore; bridge!: FcrBridge; io!: TaskIO; links!: SourceLinkService; engine!: SyncEngine;
  private popover?: TaskPopover; private anchor?: HTMLElement; private timers = new Set<number>();
  private interval?: number; private debounceTimer?: number; private status?: HTMLElement; private colors = new Map<string, string | undefined>();
  private alive = true;
  private modals = new Set<Modal>();
  async onload() {
    this.store = new TaskStore(data => this.saveData(data));
    try { this.store.load(await this.loadData()); } catch (error) { new Notice(String(error)); return; }
    this.bridge = new FcrBridge(this.app, () => this.store.data.settings.token);
    this.io = new TaskIO(this.app, new WriteGuard()); this.links = new SourceLinkService(this.app, this.store, this.io);
    this.engine = new SyncEngine(this.store, this.bridge, this.io, new DailyNoteInbox(this.app, this.store, this.io.guard), this.links,
      () => this.invalidate(), delay => this.after(delay, () => this.requestSync(false)));
    this.status = this.addStatusBarItem();
    this.addSettingTab(new FreedomSettingsTab(this.app, this));
    this.registerEditorExtension(taskEditorExtension(this.store, id => this.colors.get(id), (path, line, anchor) => this.openTask(path, line, anchor)));
    this.addCommand({ id: 'schedule-task-under-cursor', name: 'Schedule task under cursor', editorCheckCallback: (checking, editor, view) => {
      const line = editor.getCursor().line; if (!view.file || !parseTasks(editor.getValue()).some(t => t.line === line)) return false;
      if (!checking) this.openTask(view.file.path, line); return true;
    } });
    this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => { void this.perform(() => this.engine.sync(true)); } });
    this.addCommand({ id: 'open-calendar', name: 'Open calendar', callback: () => { void this.perform(() => this.bridge.openCalendar()); } });
    this.addCommand({ id: 'view-conflicts', name: 'View conflicts', callback: () => this.openConflicts() });
    this.registerObsidianProtocolHandler('freedom-task', params => {
      if (params.vault && params.vault !== this.app.vault.getName()) return;
      if (params.task) void this.perform(() => this.links.open(params.task));
    });
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      const line = editor.getCursor().line; if (!view.file || !parseTasks(editor.getValue()).some(t => t.line === line)) return;
      menu.addItem(item => item.setTitle('Schedule task…').setIcon('calendar-plus').onClick(() => this.openTask(view.file!.path, line)));
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.popover?.close()));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (!(file instanceof TFile) || file.extension !== 'md' || this.io.guard.has(file.path)) return;
      this.io.modified(file.path);
      if (!this.store.data.settings.automatic) return;
      if (this.store.records().some(r => r.locator.sourcePath === file.path || r.missingSince !== undefined)) this.debounce();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { void this.perform(() => this.engine.rename(oldPath, file.path)); }));
    this.registerEvent(this.app.vault.on('delete', file => {
      for (const record of this.store.records()) if (record.locator.sourcePath === file.path || record.locator.sourcePath.startsWith(`${file.path}/`)) record.state = 'orphaned';
      void this.perform(() => this.store.save()); this.invalidate();
    }));
    this.app.workspace.onLayoutReady(() => {
      if (!this.alive) return;
      for (const file of this.app.vault.getMarkdownFiles()) if (Date.now() - file.stat.mtime < 5 * 60_000) this.io.recent.set(file.path, file.stat.mtime);
      this.configureInterval(); this.invalidate(); if (this.store.data.settings.automatic) this.requestSync(true);
    });
  }
  async perform(work: () => Promise<unknown>): Promise<void> {
    try { await work(); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.invalidate(); }
  }
  requestSync(refresh: boolean) {
    if (!this.alive) return;
    void this.engine.sync(refresh).catch(() => this.invalidate());
  }
  after(delay: number, work: () => void | Promise<void>) {
    if (!this.alive) return;
    const timer = window.setTimeout(() => { this.timers.delete(timer); if (this.alive) void Promise.resolve(work()).catch(error => { this.engine.lastError = String(error); this.invalidate(); }); }, delay);
    this.timers.add(timer);
  }
  private debounce() {
    if (this.debounceTimer !== undefined) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => { this.debounceTimer = undefined; this.requestSync(false); }, 800);
  }
  private configureInterval() {
    if (this.interval !== undefined) window.clearInterval(this.interval);
    if (this.store.data.settings.automatic) this.interval = window.setInterval(() => this.requestSync(true), this.store.data.settings.intervalMinutes * 60_000);
  }
  async persistSettings() { await this.store.save(); this.configureInterval(); this.invalidate(); }
  invalidate() {
    if (!this.alive || !this.bridge || !this.engine) return;
    try { this.colors = new Map(this.bridge.calendars().map(c => [c.id, c.color])); } catch { this.colors.clear(); }
    const issues = this.store.records().some(r => r.conflicts.length || ['needsRepair', 'orphaned', 'pendingCreate', 'pendingImport'].includes(r.state));
    const status = this.engine.busy ? 'Freedom Tasks: syncing…' : !this.bridge.installed() ? 'Freedom Tasks: Full Calendar required' : !this.bridge.connected() ? 'Freedom Tasks: authorize' : this.engine.lastError ? 'Freedom Tasks: sync failed' : issues ? 'Freedom Tasks: review tasks' : '';
    this.status?.setText(status);
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof MarkdownView) {
        const editor = leaf.view.editor as typeof leaf.view.editor & { cm?: { dispatch(spec: unknown): void } };
        editor.cm?.dispatch({ effects: refreshTasks.of() });
      }
    });
  }
  openTask(path: string, line: number, anchor?: HTMLElement) {
    if (this.popover && this.anchor === anchor && anchor) { this.popover.close(); return; }
    this.popover?.close(); this.anchor = anchor; this.popover = new TaskPopover(this, path, line, anchor); this.popover.open();
  }
  popoverClosed(popover: TaskPopover) { if (this.popover === popover) { this.popover = undefined; this.anchor = undefined; } }
  trackModal(modal: Modal) { this.modals.add(modal); }
  untrackModal(modal: Modal) { this.modals.delete(modal); }
  openConflicts() { this.popover?.close(); new ConflictModal(this).open(); }
  openSettings() { const settings = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting; settings.open(); settings.openTabById(this.manifest.id); }
  defaultCalendar(path: string): string {
    const file = this.io.file(path); const override: unknown = file ? this.app.metadataCache.getFileCache(file)?.frontmatter?.['task-calendar'] : undefined;
    const calendars = this.bridge.calendars().filter(c => this.store.data.settings.managed.includes(c.id));
    if (override !== undefined) {
      const matches = calendars.filter(c => c.name === override); if (matches.length === 1) return matches[0].id;
      new Notice('This note’s task-calendar does not match one managed calendar. Using the global default.');
    }
    return this.store.data.settings.defaultCalendar;
  }
  calendarName(id: string) { try { return this.bridge.calendars().find(c => c.id === id)?.name || 'Unavailable calendar'; } catch { return 'Unavailable calendar'; } }
  onunload() {
    this.alive = false; this.engine?.stop();
    for (const modal of this.modals) modal.close(); this.modals.clear();
    for (const timer of this.timers) window.clearTimeout(timer); this.timers.clear();
    if (this.interval !== undefined) window.clearInterval(this.interval);
    if (this.debounceTimer !== undefined) window.clearTimeout(this.debounceTimer);
  }
}

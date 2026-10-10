import { Modal, Setting, Notice, MarkdownView, type App } from 'obsidian';
import type FreedomTasksPlugin from './main';
import { parseTasks, locate } from './markdown';
import { usableDate } from './fcr';
import type { TaskRecord } from './model';
export class ConfirmModal extends Modal {
  constructor(app: App, private title: string, private message: string, private action: () => Promise<void>, private plugin?: FreedomTasksPlugin) { super(app); plugin?.trackModal(this); }
  onClose() { this.contentEl.empty(); this.plugin?.untrackModal(this); }
  onOpen() {
    this.setTitle(this.title); this.contentEl.createEl('p', { text: this.message });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Continue').setWarning().onClick(async () => {
        button.setDisabled(true); try { await this.action(); this.close(); } catch (error) { new Notice(String(error)); button.setDisabled(false); }
      }));
  }
}
export class TaskPopover extends Modal {
  constructor(private plugin: FreedomTasksPlugin, private path: string, private line: number, private anchor?: HTMLElement) { super(plugin.app); plugin.trackModal(this); }
  onOpen() { this.modalEl.addClass('freedom-task-modal'); void this.render().catch(error => { this.contentEl.setText(String(error)); }); }
  async render() {
    const content = await this.plugin.io.read(this.path); const task = parseTasks(content).find(t => t.line === this.line);
    if (!task) { this.setTitle('Task unavailable'); this.contentEl.setText('Place the cursor on the intended checkbox and try again.'); return; }
    const mappings = this.plugin.store.records().filter(r => r.locator.sourcePath === this.path).filter(r => {
      const found = locate(content, r.locator); return found.kind === 'found' && found.task.line === this.line;
    });
    const record = mappings.length === 1 ? mappings[0] : undefined;
    this.setTitle(task.title); this.contentEl.empty();
    if (mappings.length > 1) { this.contentEl.setText('This task needs repair. Open conflicts and repair.'); return; }
    if (!this.plugin.bridge.connected()) {
      this.contentEl.createEl('p', { text: 'Connect Full Calendar Remastered in Freedom Tasks settings to schedule this task.' });
      new Setting(this.contentEl).addButton(b => b.setButtonText('Open setup').setCta().onClick(() => { this.close(); this.plugin.openSettings(); })); return;
    }
    if (record && record.state !== 'active') {
      this.contentEl.createEl('p', { text: record.state === 'detached' ? 'This task is no longer scheduled. Its mapping is retained so it can reconnect if the same remote task returns.' : 'This task needs repair before it can synchronize.' });
      new Setting(this.contentEl).addButton(b => b.setButtonText('Open repair').onClick(() => { this.close(); new ConflictModal(this.plugin).open(); }));
      new Setting(this.contentEl).addButton(b => b.setButtonText('Release saved mapping').onClick(() => new ConfirmModal(this.app, 'Release task mapping?', 'This keeps the Markdown and remote item. Releasing a mapping allows a new schedule, but a still-existing remote item will no longer reconnect to this checkbox.', async () => { await this.plugin.engine.forget(record.id); this.close(); }, this.plugin).open())); return;
    }
    const calendars = this.plugin.bridge.calendars().filter(c => this.plugin.store.data.settings.managed.includes(c.id));
    if (!calendars.length) { this.contentEl.setText('Choose managed CalDAV Tasks calendars in Freedom Tasks setup.'); return; }
    let selected = record?.calendarId || this.plugin.defaultCalendar(this.path);
    if (!calendars.some(c => c.id === selected)) selected = calendars[0].id;
    let date = record?.local.date || ''; let time = record?.local.time || '';
    const recurring = record ? this.plugin.bridge.find(record.calendarId, record.uid)?.recurring : false;
    if (recurring) this.contentEl.createEl('p', { text: 'Recurring task. Its schedule is read-only in Freedom Tasks; existing recurrence is preserved.', cls: 'freedom-subtle' });
    new Setting(this.contentEl).setName('Calendar').addDropdown(dropdown => {
      calendars.forEach(c => dropdown.addOption(c.id, c.name)); dropdown.setValue(selected).setDisabled(!!recurring).onChange(value => { selected = value; });
    });
    new Setting(this.contentEl).setName('Date').addText(text => { text.inputEl.type = 'date'; text.setValue(date).setDisabled(!!recurring).onChange(value => { date = value; }); });
    new Setting(this.contentEl).setName('Time').setDesc('Leave empty for a date-only task.').addText(text => { text.inputEl.type = 'time'; text.setValue(time).setDisabled(!!recurring).onChange(value => { time = value; }); });
    new Setting(this.contentEl).addButton(b => b.setButtonText(record ? 'Save schedule' : 'Schedule task').setCta().setDisabled(!!recurring).onClick(async () => {
      if (!usableDate(date) || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) { new Notice('Choose a valid date and optional time.'); return; }
      b.setDisabled(true);
      try { await this.plugin.engine.schedule(this.path, this.line, { date, time: time || null, calendarId: selected }); this.close(); this.plugin.requestSync(false); }
      catch (error) { new Notice(String(error)); b.setDisabled(false); this.plugin.invalidate(); }
    }));
    const actions = this.contentEl.createDiv('freedom-task-links');
    new Setting(actions).addButton(b => b.setButtonText('Open calendar').onClick(() => { void this.plugin.perform(() => this.plugin.bridge.openCalendar()); }));
    if (record) {
      new Setting(actions).addButton(b => b.setButtonText('Open source note').onClick(() => { this.close(); void this.plugin.links.open(record.id); }))
        .addButton(b => b.setButtonText('Remove from calendar').setWarning().onClick(() => new ConfirmModal(this.app, 'Remove from calendar?', 'The calendar task will be deleted. The Markdown checkbox will remain.', async () => { await this.plugin.engine.remove(record.id); this.close(); }, this.plugin).open()));
    }
    if (this.anchor && window.innerWidth > 600) {
      this.containerEl.addClass('freedom-task-anchored');
      const rect = this.anchor.getBoundingClientRect(); const width = Math.min(360, window.innerWidth - 24);
      this.modalEl.style.width = `${width}px`; this.modalEl.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      this.modalEl.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - this.modalEl.offsetHeight - 12))}px`;
    }
  }
  onClose() { this.contentEl.empty(); this.plugin.popoverClosed(this); this.plugin.untrackModal(this); }
}
export class ConflictModal extends Modal {
  constructor(private plugin: FreedomTasksPlugin) { super(plugin.app); plugin.trackModal(this); }
  onClose() { this.contentEl.empty(); this.plugin.untrackModal(this); }
  onOpen() { this.setTitle('Task conflicts and repair'); this.render(); }
  render() {
    this.contentEl.empty(); const records = this.plugin.store.records().filter(r => r.conflicts.length || ['needsRepair', 'orphaned', 'pendingCreate', 'pendingImport'].includes(r.state));
    if (!records.length) { this.contentEl.createEl('p', { text: 'No conflicts or tasks needing repair.' }); return; }
    for (const record of records) {
      const section = this.contentEl.createDiv('freedom-conflict'); section.createEl('h3', { text: record.locator.title });
      section.createEl('p', { text: record.locator.sourcePath, cls: 'freedom-subtle' });
      for (const conflict of record.conflicts) {
        section.createEl('h4', { text: conflict.field === 'calendarId' ? 'Calendar' : conflict.field[0].toUpperCase() + conflict.field.slice(1) });
        const display = (value: string | boolean | null) => conflict.field === 'calendarId' ? this.plugin.calendarName(String(value)) : value === null ? 'Date only' : String(value);
        section.createEl('p', { text: `Obsidian: ${display(conflict.local)}` }); section.createEl('p', { text: `Nextcloud: ${display(conflict.remote)}` });
        new Setting(section).addButton(b => b.setButtonText('Keep Obsidian').onClick(() => this.resolve(record, conflict.field, 'local')))
          .addButton(b => b.setButtonText('Keep Nextcloud').onClick(() => this.resolve(record, conflict.field, 'remote')));
      }
      if (record.state !== 'active' && record.state !== 'detached') {
        section.createEl('p', { text: record.state === 'pendingCreate' ? 'Remote creation needs confirmation. Sync first; automatic retries are disabled.' : 'Choose the intended checkbox explicitly to repair this mapping.' });
        new Setting(section).addButton(b => b.setButtonText('Open source').onClick(() => { void this.plugin.links.open(record.id); }))
          .addButton(b => b.setButtonText('Relink to task under cursor').onClick(async () => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView); if (!view?.file) { new Notice('Open the intended note and place the cursor on its checkbox.'); return; }
            await this.plugin.perform(async () => { await this.plugin.engine.relink(record.id, view.file!.path, view.editor.getCursor().line); await this.plugin.engine.sync(); }); this.render();
          }));
        new Setting(section).addButton(b => b.setButtonText('Release mapping').onClick(() => new ConfirmModal(this.app, 'Release saved mapping?', 'This does not delete Markdown or calendar data. Confirm the remote state before scheduling again to avoid duplicates.', async () => { await this.plugin.engine.forget(record.id); this.render(); }, this.plugin).open()));
      }
    }
  }
  private async resolve(record: TaskRecord, field: Parameters<FreedomTasksPlugin['engine']['resolve']>[1], side: 'local' | 'remote') {
    await this.plugin.perform(() => this.plugin.engine.resolve(record.id, field, side)); this.render();
  }
}

import { PluginSettingTab, Setting, Notice, type App } from 'obsidian';
import type FreedomTasksPlugin from './main';
export class FreedomSettingsTab extends PluginSettingTab {
  constructor(app: App, private freedom: FreedomTasksPlugin) { super(app, freedom); }
  display() {
    const { containerEl: root } = this; root.empty(); root.addClass('freedom-settings');
    const plugin = this.freedom; const settings = plugin.store.data.settings;
    root.createEl('h2', { text: 'Freedom Tasks' });
    root.createEl('p', { text: 'Plain checkboxes, connected to your scheduled task calendars.', cls: 'freedom-subtle' });
    root.createEl('h3', { text: 'Full Calendar' });
    new Setting(root).setName('Full Calendar Remastered').setDesc(plugin.bridge.installed() ? 'Installed. Nextcloud credentials stay in Full Calendar.' : 'Required: install and enable Full Calendar Remastered. Configure Calendar Sources → CalDAV Tasks.')
      .addButton(button => button.setButtonText(plugin.bridge.connected() ? 'Reauthorize' : 'Authorize').setDisabled(!plugin.bridge.installed()).onClick(async () => {
        button.setDisabled(true);
        await plugin.perform(async () => { const token = await plugin.bridge.authorize(); if (!token) return;
          settings.token = token; await plugin.store.save(); plugin.requestSync(true); }); this.display();
      }));
    root.createEl('p', { text: 'Authorization allows reading and editing events, viewing and refreshing providers, and opening the calendar. No full system access.', cls: 'freedom-subtle' });
    if (!plugin.bridge.connected()) { root.createEl('p', { text: 'Authorize to choose managed calendars and finish setup.' }); return; }
    let calendars;
    try { calendars = plugin.bridge.calendars(); } catch (error) { root.createEl('p', { text: String(error) }); return; }
    root.createEl('h3', { text: 'Calendars' });
    if (!calendars.length) root.createEl('p', { text: 'No writable task calendars. In Full Calendar, open Calendar Sources and add CalDAV Tasks. Ordinary CalDAV event sources are not supported.' });
    for (const calendar of calendars) new Setting(root).setName(calendar.name).setDesc('Manage scheduled tasks in this calendar.').addToggle(toggle => toggle.setValue(settings.managed.includes(calendar.id)).onChange(async value => {
      settings.managed = value ? [...new Set([...settings.managed, calendar.id])] : settings.managed.filter(id => id !== calendar.id);
      if (!settings.managed.includes(settings.defaultCalendar)) settings.defaultCalendar = settings.managed[0] || '';
      await plugin.persistSettings(); this.display();
    }));
    new Setting(root).setName('Default task calendar').setDesc('A note’s task-calendar property can override this by calendar name.').addDropdown(dropdown => {
      dropdown.addOption('', 'Choose a calendar'); calendars.filter(c => settings.managed.includes(c.id)).forEach(c => dropdown.addOption(c.id, c.name));
      dropdown.setValue(settings.defaultCalendar).onChange(async value => { settings.defaultCalendar = value; await plugin.persistSettings(); });
    });
    root.createEl('h3', { text: 'Notes' });
    new Setting(root).setName('Incoming Daily Note heading').setDesc('Newly eligible remote tasks go into today’s configured Daily Note, regardless of due date.').addText(text => text.setValue(settings.heading).onChange(async value => {
      settings.heading = value.trim().replace(/[\r\n#]/g, '') || 'Tasks'; await plugin.persistSettings();
    }));
    new Setting(root).setName('Fallback inbox note').setDesc('Used when the Daily Notes integration is unavailable.').addText(text => text.setValue(settings.fallbackPath).onChange(async value => {
      settings.fallbackPath = value.trim() || 'Freedom Tasks Inbox.md'; await plugin.persistSettings();
    }));
    const pending = settings.managed.some(id => !plugin.store.data.initializedCalendars.includes(id));
    if (pending) {
      root.createEl('h3', { text: 'Finish setup' }); let importExisting = false;
      new Setting(root).setName('Import existing incomplete scheduled tasks').setDesc('Off by default. Leaving it off records current remote tasks as the starting baseline; only new scheduled tasks are added later. Undated tasks are out of scope.').addToggle(toggle => toggle.setValue(false).onChange(value => { importExisting = value; }));
      new Setting(root).addButton(button => button.setButtonText('Finish setup').setCta().setDisabled(!settings.managed.length || !settings.defaultCalendar).onClick(() => {
        button.setDisabled(true); button.setButtonText('Refreshing calendars…');
        void plugin.perform(async () => {
          plugin.bridge.refresh(settings.managed);
          // FCR has no refresh completion promise: one bounded follow-up, not aggressive polling.
          plugin.after(3000, async () => { await plugin.perform(() => plugin.engine.initializeCalendars(importExisting)); this.display(); plugin.requestSync(false); });
        });
      }));
    } else new Setting(root).setName('Import existing incomplete scheduled tasks').setDesc('Optional explicit import. Previously mapped tasks are never added twice.').addButton(b => b.setButtonText('Import now').onClick(async () => { await plugin.perform(() => plugin.engine.initializeCalendars(true)); this.display(); }));
    root.createEl('h3', { text: 'Sync' });
    new Setting(root).setName('Automatic synchronization').addToggle(toggle => toggle.setValue(settings.automatic).onChange(async value => { settings.automatic = value; await plugin.persistSettings(); }));
    new Setting(root).setName('Remote reconciliation interval').setDesc('Minutes. Default: 2.').addText(text => text.setValue(String(settings.intervalMinutes)).onChange(async value => {
      const minutes = Number(value); if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return;
      settings.intervalMinutes = minutes; await plugin.persistSettings();
    }));
    new Setting(root).setName('Sync now').setDesc(plugin.engine.lastError || (plugin.store.data.lastSync ? `Last successful sync: ${new Date(plugin.store.data.lastSync).toLocaleString()}` : 'No completed synchronization yet.')).addButton(b => b.setButtonText('Sync now').onClick(async () => { await plugin.perform(() => plugin.engine.sync(true)); this.display(); }));
    new Setting(root).setName('Conflicts and repair').setDesc(`${plugin.store.records().reduce((n, r) => n + r.conflicts.length, 0)} field conflicts`).addButton(b => b.setButtonText('Review').onClick(() => plugin.openConflicts()));
    root.createEl('h3', { text: 'Advanced' });
    new Setting(root).setName('Remote deletion behavior').setDesc('Keep the Markdown checkbox and detach its mapping. If the same UID becomes scheduled again, reconnect instead of importing a duplicate.');
    root.createEl('p', { text: 'Reliable multi-device use requires syncing both your vault and Freedom Tasks plugin data. Never run competing task writes intentionally.', cls: 'freedom-subtle' });
  }
}

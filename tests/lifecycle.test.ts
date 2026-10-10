import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian-daily-notes-interface', () => ({ appHasDailyNotesPluginLoaded: () => false, getDailyNote: vi.fn(), getAllDailyNotes: vi.fn(), createDailyNote: vi.fn() }));
import FreedomTasksPlugin from '../src/main';
import { Plugin, Notice } from './obsidian';
import type { App, PluginManifest, Modal } from 'obsidian';
function app() {
  return {
    plugins: { plugins: {} },
    vault: { on: vi.fn(), getMarkdownFiles: () => [], getName: () => 'Vault' },
    workspace: { on: vi.fn(), onLayoutReady: (fn: () => void) => fn(), iterateAllLeaves: vi.fn() },
  } as unknown as App;
}
describe('runtime lifecycle', () => {
  it('loads without FCR, offers commands/setup, and tears down its timer safely', async () => {
    const clear = vi.fn(); vi.stubGlobal('window', { setInterval: () => 42, clearInterval: clear, clearTimeout: vi.fn() });
    Notice.messages = [];
    const plugin = new FreedomTasksPlugin(app(), { id: 'freedom-tasks' } as PluginManifest);
    await plugin.onload(); await plugin.engine.sync().catch(() => {});
    const loaded = plugin as unknown as Plugin;
    expect(loaded.commands).toHaveLength(4); expect(loaded.extensions).toHaveLength(1); expect(loaded.tabs).toHaveLength(1);
    expect(loaded.statusBar.text).toBe('Freedom Tasks: Full Calendar required'); expect(Notice.messages).toEqual([]);
    expect(loaded.handlers.has('freedom-task')).toBe(true);
    const close = vi.fn(); plugin.trackModal({ close } as unknown as Modal);
    plugin.onunload(); expect(close).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledWith(42); vi.unstubAllGlobals();
  });
  it('refuses an unknown schema without saving over user data', async () => {
    const plugin = new FreedomTasksPlugin(app(), { id: 'freedom-tasks' } as PluginManifest);
    vi.spyOn(plugin, 'loadData').mockResolvedValue({ version: 99 }); const save = vi.spyOn(plugin, 'saveData');
    await plugin.onload(); expect(save).not.toHaveBeenCalled(); expect(plugin.engine).toBeUndefined();
    plugin.onunload();
  });
});

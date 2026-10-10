import { MarkdownView, Notice, type App } from 'obsidian';
import type { TaskStore } from './store';
import type { TaskIO } from './task-io';
export class SourceLinkService {
  constructor(private app: App, private store: TaskStore, private io: TaskIO) {}
  uri(id: string): string { return `obsidian://freedom-task?vault=${encodeURIComponent(this.app.vault.getName())}&task=${encodeURIComponent(id)}`; }
  async open(id: string) {
    const record = this.store.data.tasks[id]; if (!record) { new Notice('This Freedom Task mapping is unavailable on this device.'); return; }
    const found = await this.io.locate(record); const path = found.kind === 'found' ? found.path : record.locator.sourcePath;
    const file = this.io.file(path); if (!file) { new Notice('Source note is missing. Open Freedom Tasks repair.'); return; }
    const leaf = this.app.workspace.getLeaf(false); await leaf.openFile(file);
    if (found.kind === 'found' && leaf.view instanceof MarkdownView) {
      const pos = { line: found.task.line, ch: 0 }; leaf.view.editor.setCursor(pos); leaf.view.editor.scrollIntoView({ from: pos, to: pos }, true);
    } else new Notice('Task needs repair. The note was opened without selecting another checkbox.');
  }
}

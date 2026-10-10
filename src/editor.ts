import { StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, setIcon } from 'obsidian';
import { parseTasks, locate } from './markdown';
import type { TaskStore } from './store';
export const refreshTasks = StateEffect.define<void>();
export function dateLabel(date: string, time: string | null): string {
  const parsed = new Date(`${date}T${time || '12:00'}`);
  if (!Number.isFinite(parsed.getTime())) return date;
  const day = parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return time ? `${day} · ${parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : day;
}
class ScheduleWidget extends WidgetType {
  constructor(private label: string, private color: string | undefined, private action: (el: HTMLElement) => void) { super(); }
  toDOM() {
    const button = document.createElement('button'); button.className = 'freedom-task-action';
    button.type = 'button'; button.contentEditable = 'false'; button.setAttribute('aria-label', this.label ? `Edit task schedule: ${this.label}` : 'Schedule task');
    if (this.color && CSS.supports('color', this.color)) { const dot = document.createElement('span'); dot.className = 'freedom-calendar-dot'; dot.style.backgroundColor = this.color; button.append(dot); }
    if (this.label) { const label = document.createElement('span'); label.textContent = this.label; button.append(label); }
    else { const icon = document.createElement('span'); setIcon(icon, 'calendar-plus'); button.append(icon); }
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); this.action(button); }); return button;
  }
  ignoreEvent() { return true; }
}
export function taskEditorExtension(store: TaskStore, calendarColor: (id: string) => string | undefined,
  open: (path: string, line: number, anchor: HTMLElement) => void): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) { this.build(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.some(t => t.effects.some(e => e.is(refreshTasks)))) this.build(update.view);
    }
    build(view: EditorView) {
      const info = view.state.field(editorInfoField, false); const path = info?.file?.path;
      if (!path) { this.decorations = Decoration.none; return; }
      const content = view.state.doc.toString(); const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
      const records = store.records().filter(r => r.locator.sourcePath === path);
      const located = records.map(record => ({ record, result: locate(content, record.locator) }));
      const decorations = [];
      for (const task of parseTasks(content)) {
        const matches = located.filter(item => item.result.kind === 'found' && item.result.task.line === task.line);
        const record = matches.length === 1 ? matches[0].record : undefined;
        const scheduled = record?.state === 'active' && !record.missingSince;
        if (!scheduled && task.line !== activeLine) continue;
        // Detached/repair items still open their mapping controls when focused.
        const label = scheduled ? dateLabel(record.local.date, record.local.time) : '';
        const line = view.state.doc.line(task.line + 1);
        decorations.push(Decoration.widget({ widget: new ScheduleWidget(label,
          scheduled ? calendarColor(record.calendarId) : undefined, anchor => open(path, task.line, anchor)), side: 1 }).range(line.to));
      }
      this.decorations = Decoration.set(decorations, true);
    }
  }, { decorations: plugin => plugin.decorations });
}

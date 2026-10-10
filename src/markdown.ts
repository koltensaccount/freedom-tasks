import type { Locator } from './model';
export interface MarkdownTask {
  line: number; text: string; title: string; completed: boolean;
  prefix: string; suffix: string;
}
export const visibleTitle = (title: string): string => title
  .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`~]/g, '').trim();
export const hasMarkup = (title: string): boolean => /\[\[|\[[^\]]+\]\(|[*_`~<>]/.test(title);
export function parseTasks(content: string): MarkdownTask[] {
  const lines = content.split('\n'); const tasks: MarkdownTask[] = [];
  let fence: string | null = null; let frontmatter = lines[0]?.trim() === '---';
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line].replace(/\r$/, '');
    if (frontmatter) { if (line > 0 && /^(---|\.\.\.)\s*$/.test(text)) frontmatter = false; continue; }
    const marker = text.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1][0]; else if (marker[1][0] === fence) fence = null; continue; }
    if (fence) continue;
    const match = text.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/);
    if (match) tasks.push({ line, text, title: match[4], completed: match[2].toLowerCase() === 'x', prefix: match[1], suffix: match[3] });
  }
  return tasks;
}
export function capture(path: string, content: string, task: MarkdownTask): Locator {
  const lines = content.split('\n').map(s => s.replace(/\r$/, ''));
  return { sourcePath: path, lineHint: task.line, sourceText: task.text, title: task.title,
    before: lines.slice(Math.max(0, task.line - 2), task.line), after: lines.slice(task.line + 1, task.line + 3),
    duplicateCount: parseTasks(content).filter(t => t.title === task.title).length };
}
type Location = { kind: 'found'; task: MarkdownTask } | { kind: 'missing' | 'ambiguous' };
const equal = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export function locate(content: string, locator: Locator): Location {
  const tasks = parseTasks(content); const lines = content.split('\n').map(s => s.replace(/\r$/, ''));
  const context = (task: MarkdownTask) => {
    const before = equal(locator.before, lines.slice(Math.max(0, task.line - 2), task.line));
    const after = equal(locator.after, lines.slice(task.line + 1, task.line + 3));
    const evidence = (before && locator.before.some(Boolean) ? 2 : 0) + (after && locator.after.some(Boolean) ? 2 : 0);
    return { exact: before && after, evidence };
  };
  const candidates = tasks.filter(t => t.title === locator.title);
  const ranked = candidates.map(task => ({ task, ...context(task) })).sort((a, b) => b.evidence - a.evidence);
  if (ranked.length) {
    if (ranked.length === 1 && locator.duplicateCount === 1 &&
      (ranked[0].task.text === locator.sourceText || ranked[0].evidence >= 2 || ranked[0].task.line === locator.lineHint)) return { kind: 'found', task: ranked[0].task };
    if (ranked[0].evidence >= 2 && (!ranked[1] || ranked[0].evidence > ranked[1].evidence)) return { kind: 'found', task: ranked[0].task };
    return { kind: 'ambiguous' };
  }
  const atHint = tasks.find(t => t.line === locator.lineHint);
  if (atHint && context(atHint).exact && context(atHint).evidence >= 2) return { kind: 'found', task: atHint };
  // Prove a task-line removal through now-adjacent former neighbors. Otherwise
  // a title/context rewrite may have obscured identity; never delete remotely.
  const neighbors = [...locator.before, ...locator.after];
  const adjacent = neighbors.some(Boolean) && lines.some((_, index) => equal(neighbors, lines.slice(index, index + neighbors.length)));
  if (adjacent || (!tasks.length && !content.trim())) return { kind: 'missing' };
  return { kind: 'ambiguous' };
}
export function replaceTask(content: string, locator: Locator, title: string, completed: boolean): string {
  const result = locate(content, locator);
  if (result.kind !== 'found') throw new Error('Task needs repair; no checkbox was changed.');
  const lines = content.split('\n'); const cr = lines[result.task.line].endsWith('\r') ? '\r' : '';
  if (/[\r\n]/.test(title)) throw new Error('A task title must stay on one Markdown line.');
  lines[result.task.line] = `${result.task.prefix}${completed ? 'x' : ' '}${result.task.suffix}${title}${cr}`;
  return lines.join('\n');
}

export class TFile {
  extension = 'md'; stat = { mtime: Date.now() };
  constructor(public path = '') {}
}
export const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/');
export class Notice { static messages: string[] = []; constructor(public message: string) { Notice.messages.push(message); } }
export class MarkdownView {}
export class Modal { constructor(public app: unknown) {} }
export class Setting {}
export class PluginSettingTab { constructor(..._args: unknown[]) {} }
export const editorInfoField = undefined;
export const setIcon = () => {};
export class Plugin {
  commands: unknown[] = []; extensions: unknown[] = []; handlers = new Map<string, unknown>(); tabs: unknown[] = [];
  statusBar = { text: '', setText(text: string) { this.text = text; } };
  constructor(public app: unknown, public manifest: unknown) {}
  async loadData() { return null; } async saveData(_data: unknown) {}
  addStatusBarItem() { return this.statusBar; } addSettingTab(tab: unknown) { this.tabs.push(tab); }
  registerEditorExtension(extension: unknown) { this.extensions.push(extension); }
  addCommand(command: unknown) { this.commands.push(command); }
  registerEvent(_ref: unknown) {}
  registerObsidianProtocolHandler(name: string, handler: unknown) { this.handlers.set(name, handler); }
}

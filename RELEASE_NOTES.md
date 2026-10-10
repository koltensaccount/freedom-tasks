Freedom Tasks 0.1.0-beta.2

Fixes the Obsidian load failure in beta.1: `Cannot find module 'moment'`.

The Daily Note integration now uses Obsidian's exported Moment instance. The production bundle no longer requires the bare `moment` package. No features or synchronization behavior changed.

Validated with a production build, a runtime-require audit, and a real plugin load smoke test in Obsidian 1.14.4 with Full Calendar Remastered absent. The plugin loads and shows its graceful required-dependency state. No full test suite was run for this packaging fix.

Runtime modules are limited to `obsidian`, `@codemirror/state`, and `@codemirror/view`. The Daily Notes helper and its ordinary dependencies are bundled.

Install/update through BRAT, or use the attached main.js, manifest.json, and styles.css. Beta.1 is retained unchanged.

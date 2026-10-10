import esbuild from "esbuild";
import { readFileSync } from "node:fs";
const notices = [
  ["obsidian-daily-notes-interface", "node_modules/obsidian-daily-notes-interface/LICENSE"],
  ["tslib copyright", "node_modules/tslib/CopyrightNotice.txt"],
  ["tslib license", "node_modules/tslib/LICENSE.txt"],
].map(([name, path]) => `${name}\n${readFileSync(path, "utf8")}`).join("\n\n");
await esbuild.build({
  entryPoints: ["src/main.ts"], bundle: true, format: "cjs", target: "es2022",
  external: ["obsidian", "@codemirror/state", "@codemirror/view"],
  outfile: "main.js", logLevel: "info", minify: true,
  banner: { js: `/* Bundled dependency notices\n${notices.replaceAll("*/", "* /")}\n*/` },
});

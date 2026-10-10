import esbuild from "esbuild";
await esbuild.build({
  entryPoints: ["src/main.ts"], bundle: true, format: "cjs", target: "es2022",
  external: ["obsidian", "moment", "@codemirror/state", "@codemirror/view"],
  outfile: "main.js", logLevel: "info", minify: true,
});

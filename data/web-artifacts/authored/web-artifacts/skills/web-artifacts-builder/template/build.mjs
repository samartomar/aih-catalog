// Catalog-authored bounded inline route. Build only trusted local project code.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
const [major, minor, patch] = process.versions.node.split('.').map(Number);
assert(major === 26 && (minor > 12 || (minor === 12 && patch >= 1)), 'Artifact build requires Node >=26.12.1 <27');
const result = await build({
  configFile: false, plugins: [react(), tailwind()], base: './', publicDir: false,
  build: {write: false, modulePreload: false, cssCodeSplit: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rolldownOptions: {output: {codeSplitting: false}}},
});
assert(!Array.isArray(result), 'Expected one build');
const output = result.output;
const html = output.find(file => file.type === 'asset' && file.fileName === 'index.html');
assert(html && typeof html.source === 'string', 'Missing HTML');
let text = html.source;
const consumed = new Set(['index.html']);
text = text.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_tag, src) => {
  const name = src.replace(/^\.\//, '');
  const chunk = output.find(file => file.type === 'chunk' && file.fileName === name);
  assert(chunk && chunk.imports.length === 0 && chunk.dynamicImports.length === 0, `Unbundled script ${src}`);
  consumed.add(name);
  // HTML raw-text end tags must remain escaped inside generated JavaScript.
  return `<script type="module">${chunk.code.replace(/<\/script/gi, '<\\/script')}</script>`;
});
text = text.replace(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g, (tag, href) => {
  assert(/rel="stylesheet"/.test(tag), `Unsupported linked resource ${href}`);
  const name = href.replace(/^\.\//, '');
  const css = output.find(file => file.type === 'asset' && file.fileName === name);
  assert(css && typeof css.source === 'string', `Missing CSS ${href}`);
  consumed.add(name);
  return `<style>${css.source.replace(/<\/style/gi, '<\\/style')}</style>`;
});
assert(output.every(file => consumed.has(file.fileName)), 'Unbundled output asset; import assets through source modules/CSS');
assert(!/<(?:script|link)\b[^>]*(?:src|href)=/i.test(text), 'External build resource');
await mkdir('dist', {recursive: true});
await writeFile('dist/artifact.html', text, {flag: 'wx'});
console.log('Built dist/artifact.html; reopen offline and verify requests for your application.');

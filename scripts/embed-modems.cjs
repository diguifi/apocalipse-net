// Rebuild the offline HTML after editing src/protocols.js or the vendored modem.
const fs = require('node:fs');
const loader = fs.readFileSync('vendor/mt63/mt63Wasm.js', 'utf8').replace(/[ \t]+(?=\r?$)/gm, '');
const binary = fs.readFileSync('vendor/mt63/mt63Wasm.wasm').toString('base64');
const protocols = fs.readFileSync('src/protocols.js', 'utf8');
const block = '<!-- BEGIN GENERATED MODEMS -->\n<script id="mt63-runtime">\n' +
  '// @hamstudy/mt63-wasm 1.5.1, GPL-3.0-or-later. See vendor/mt63/NOTICE.md.\n' +
  '(function(global){\n' + loader + '\n' +
  'global.createMT63Module = function(){return Module({wasmBinary:Uint8Array.from(atob("' + binary +
  '"),c=>c.charCodeAt(0)),print:function(){}});};\n})(globalThis);\n</script>\n' +
  '<script id="protocols">\n' + protocols + '\n</script>\n' +
  '<script id="capture">\n' + fs.readFileSync('src/capture.js','utf8') + '\n</script>\n<!-- END GENERATED MODEMS -->';
let html = fs.readFileSync('apocalipse.html', 'utf8');
if (html.includes('<!-- BEGIN GENERATED MODEMS -->')) {
  html = html.replace(/<!-- BEGIN GENERATED MODEMS -->[\s\S]*?<!-- END GENERATED MODEMS -->/, () => block);
} else {
  html = html.replace('</script>\n<script>', '</script>\n' + block + '\n<script>');
  // Accommodate checkouts with CRLF line endings.
  if (!html.includes('<!-- BEGIN GENERATED MODEMS -->')) html = html.replace('</script>\r\n<script>', '</script>\r\n' + block + '\r\n<script>');
}
if (!html.includes('<!-- BEGIN GENERATED MODEMS -->')) throw Error('Core/UI script boundary missing');
html = html.replace(/<script id="app">[\s\S]*?<\/script>/, () => '<script id="app">\n' + fs.readFileSync('src/app.js', 'utf8') + '\n</script>');
fs.writeFileSync('apocalipse.html', html);

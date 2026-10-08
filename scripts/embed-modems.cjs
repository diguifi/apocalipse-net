// Rebuild the portable page from its shared sources.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const loader = fs.readFileSync('vendor/mt63/mt63Wasm.js', 'utf8').replace(/[ \t]+(?=\r?$)/gm, '');
const binary = fs.readFileSync('vendor/mt63/mt63Wasm.wasm').toString('base64');
const core = '<script id="core">\n' + fs.readFileSync('src/core.js', 'utf8') + '</script>';
const modems = '<!-- BEGIN GENERATED MODEMS -->\n<script id="mt63-runtime">\n' +
  '// @hamstudy/mt63-wasm 1.5.0, GPL-3.0-or-later. Source and license: see the page footer.\n' +
  '(function(global){\n' + loader + '\n' +
  'global.createMT63Module = function(){return Module({wasmBinary:Uint8Array.from(atob("' + binary +
  '"),c=>c.charCodeAt(0)),print:function(){}});};\n})(globalThis);\n</script>\n' +
  '<script id="protocols">\n' + fs.readFileSync('src/protocols.js', 'utf8') + '\n</script>\n' +
  '<script id="capture">\n' + fs.readFileSync('src/capture.js', 'utf8') + '\n</script>\n<!-- END GENERATED MODEMS -->';

function embed(html, app) {
  const archive = spawnSync('tar', ['-czf', '-', 'src', 'scripts', 'vendor', 'README.md', 'COPYING.txt'], { maxBuffer: 10 * 1024 * 1024 });
  if (archive.status !== 0) throw Error('Could not package source: ' + archive.stderr.toString());
  if (!html.includes('__SOURCE_BUNDLE__')) throw Error('Source bundle link missing');
  if (!/<script id="core">[\s\S]*?<\/script>/.test(html)) throw Error('Core block missing');
  if (!/<!-- BEGIN GENERATED MODEMS -->[\s\S]*?<!-- END GENERATED MODEMS -->/.test(html)) throw Error('Modem block missing');
  if (!/<script id="app">[\s\S]*?<\/script>/.test(html)) throw Error('App block missing');
  return html
    .replace('__SOURCE_BUNDLE__', archive.stdout.toString('base64'))
    .replace(/<script id="core">[\s\S]*?<\/script>/, () => core)
    .replace(/<!-- BEGIN GENERATED MODEMS -->[\s\S]*?<!-- END GENERATED MODEMS -->/, () => modems)
    .replace(/<script id="app">[\s\S]*?<\/script>/, () => '<script id="app">\n' + fs.readFileSync(app, 'utf8') + '\n</script>');
}

fs.writeFileSync('index.html', embed(fs.readFileSync('src/enhanced.html', 'utf8'), 'src/enhanced-app.js'));

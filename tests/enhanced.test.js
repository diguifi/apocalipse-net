const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function core() {
  const context = {TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, URL, Math, Uint32Array, Float32Array, console};
  vm.runInNewContext(fs.readFileSync('src/core.js', 'utf8'), context);
  return context.ApocalypseCore;
}

test('general files preserve exact bytes and metadata', () => {
  const c = core();
  for (const [name, type, data] of [
    ['notes.txt', 'text/plain', new TextEncoder().encode('Hello 🌍')],
    ['archive.zip', 'application/zip', Uint8Array.of(0x50, 0x4b, 0, 255, 42)],
    ['page.html', 'text/html', new TextEncoder().encode('<h1>Hi</h1>')],
    ['empty.bin', '', new Uint8Array(0)]
  ]) {
    const packed = c.packFile({name, type, bytes:data});
    const result = c.unpackFile(packed);
    assert.equal(result.name, name);
    assert.equal(result.type, type);
    assert.deepEqual(Array.from(result.bytes), Array.from(data));
  }
});

test('file metadata, size and checksum are validated', () => {
  const c = core();
  for (const name of ['', '../bad', 'a/b', 'a\\b', 'CON\0'])
    assert.throws(() => c.packFile({name, bytes:Uint8Array.of(1)}));
  assert.throws(() => c.packFile({name:'large.bin', bytes:new Uint8Array(c.MAX_SITE)}));
  const packed = c.packFile({name:'good.bin', bytes:Uint8Array.of(1, 2, 3)});
  const corrupt = packed.slice(); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => c.unpackFile(corrupt), /checksum/i);
  const badMeta = packed.slice(); badMeta[4] = 0xff;
  assert.throws(() => c.unpackFile(badMeta));
});

test('enhanced receiver accepts new files and legacy sites with independent sessions', () => {
  const c = core(), r = new c.EnhancedTransferReceiver();
  const file = {name:'file.zip', type:'application/zip', bytes:Uint8Array.from({length:400}, (_, i) => i & 255)};
  const files = c.makeFileTransfer(file, 77), old = c.makeTransfer(c.importHtml('legacy', 'index.html'), 77);
  assert.equal(new c.TransferReceiver().acceptFrame(files[0]), false);
  r.acceptFrame(files[0]);
  for (const frame of old) r.acceptFrame(frame);
  assert.equal(r.site.entry, 'index.html');
  for (const frame of files.slice(1)) r.acceptFrame(frame);
  assert.equal(r.file.name, file.name);
  assert.deepEqual(Array.from(r.file.bytes), Array.from(file.bytes));
  const completed = r.file;
  for (const frame of files) r.acceptFrame(frame);
  assert.equal(r.file, completed);
});

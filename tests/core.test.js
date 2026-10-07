const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');

function core() {
  const html = fs.readFileSync('apocalipse.html', 'utf8');
  const code = html.match(/<script id="core">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(code, 'inline core script exists');
  const context = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView,
    Blob, DecompressionStream, URL, Math, Uint32Array, Float32Array, console };
  vm.runInNewContext(code, context);
  return context.ApocalypseCore;
}

function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, bytes, method] of entries) {
    const n = Buffer.from(name), data = Buffer.from(bytes);
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = core().crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4);
    h.writeUInt16LE(method, 8); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(compressed.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    local.push(h, n, compressed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42); central.push(c, n);
    offset += h.length + n.length + compressed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, cd, end]));
}

test('HTML and ZIP import, safe paths and entry page', async () => {
  const c = core();
  const single = c.importHtml('<h1>Hi</h1>', 'index.html');
  assert.equal(single.entry, 'index.html');
  assert.equal(single.files[0].path, 'index.html');
  const archive = zip([
    ['site/index.html', '<link rel="stylesheet" href="style.css">', 8],
    ['site/style.css', 'body{color:red}', 0],
    ['../outside.html', 'bad', 0]
  ]);
  await assert.rejects(c.importZip(archive), /path|unsafe/i);
  const good = await c.importZip(zip([
    ['site/index.html', '<img src="img.png">', 8],
    ['site/img.png', Uint8Array.of(1, 2, 3), 0]
  ]));
  assert.equal(good.entry, 'index.html');
  assert.deepEqual(Array.from(good.files, f => f.path), ['index.html', 'img.png']);
});

test('AX.25 UI frame, FCS and bit stuffing', () => {
  const c = core(), data = Uint8Array.from([0xff, 0xf8, 0x7e, 0, 42]);
  const frame = c.createFrame(data);
  assert.deepEqual(Array.from(c.parseFrame(frame)), Array.from(data));
  frame[18] ^= 1;
  assert.equal(c.parseFrame(frame), null);
  const bits = c.frameBits(c.createFrame(data));
  assert.deepEqual(Array.from(c.bitsToFrames(bits)[0]), Array.from(c.createFrame(data)));
});

test('chunks reassemble out of order across repeats and reject corruption', () => {
  const c = core();
  const site = c.importHtml('Hello '.repeat(90), 'index.html');
  const frames = c.makeTransfer(site, 123);
  assert.ok(frames.length > 1);
  const receiver = new c.TransferReceiver();
  const corrupt = Uint8Array.from(frames[0]); corrupt[30] ^= 1;
  receiver.acceptFrame(corrupt);
  for (let i = frames.length - 1; i > 0; i--) receiver.acceptFrame(frames[i]);
  assert.equal(receiver.site, null);
  receiver.acceptFrame(frames[0]);
  assert.equal(new TextDecoder().decode(receiver.site.files[0].bytes), 'Hello '.repeat(90));
  const duplicate = receiver.progress().received;
  receiver.acceptFrame(frames[0]);
  assert.equal(receiver.progress().received, duplicate);
});

test('1200 baud AFSK round trip at 44.1 and 48 kHz', () => {
  const c = core();
  const payload = Uint8Array.from({length: 70}, (_, i) => (i * 71) & 255);
  for (const rate of [44100, 48000]) {
    const frame = c.createFrame(payload);
    const audio = c.encodeAudio([frame], rate);
    const decoded = c.decodeAudio(audio, rate);
    assert.ok(decoded.some(f => c.parseFrame(f) && Buffer.from(c.parseFrame(f)).equals(Buffer.from(payload))), `rate ${rate}`);
  }
});

test('preview resolves local assets and HTML links within recovered site', () => {
  const c = core();
  assert.equal(c.resolvePath('pages/start.html', '../images/a.png'), 'images/a.png');
  assert.equal(c.resolvePath('pages/start.html', '../../escape.png'), null);
  assert.equal(c.resolvePath('pages/start.html', 'https://example.com/a'), null);
  const site = {entry:'pages/start.html', files:[
    {path:'pages/start.html', bytes:new TextEncoder().encode('<img src="../images/a.png"><a href="next.html">next</a>')},
    {path:'pages/next.html', bytes:new TextEncoder().encode('next')},
    {path:'images/a.png', bytes:Uint8Array.of(1)}
  ]};
  const preview = c.previewReferences(site, site.entry);
  assert.equal(preview['../images/a.png'], 'images/a.png');
  assert.equal(preview['next.html'], 'pages/next.html');
});

test('compressed ZIP with dynamic Huffman blocks imports intact', async () => {
  const c = core();
  const html = '<html><body>' + Array.from({length: 300}, (_, i) => `<p class="c${i % 13}">Line ${i}: ${String.fromCharCode(65 + i % 26).repeat(i % 17)}</p>`).join('') + '</body></html>';
  const archive = zip([['index.html', html, 8]]);
  const site = await c.importZip(archive);
  assert.equal(new TextDecoder().decode(site.files[0].bytes), html);
});

test('AFSK recovers a missing packet from a repeat at lower level with noise', () => {
  const c = core();
  const frames = c.makeTransfer(c.importHtml('Radio test '.repeat(25)), 456);
  assert.ok(frames.length > 1);
  const sent = [...frames.slice(1), ...frames];
  const audio = c.encodeAudio(sent, 48000);
  for (let i = 0; i < audio.length; i++) audio[i] = audio[i] * 0.25 + Math.sin(i * 0.593) * 0.012;
  const receiver = new c.TransferReceiver();
  for (const f of c.decodeAudio(audio, 48000)) receiver.acceptFrame(f);
  assert.equal(new TextDecoder().decode(receiver.site.files[0].bytes), 'Radio test '.repeat(25));
});

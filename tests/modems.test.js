const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  const html = fs.readFileSync('apocalipse.html', 'utf8');
  const context = {TextEncoder,TextDecoder,Uint8Array,Float32Array,Float64Array,Uint32Array,
    ArrayBuffer,DataView,WebAssembly,atob,console,setTimeout,clearTimeout};
  for (const id of ['core','mt63-runtime','protocols']) {
    const match = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)<\\/script>`));
    assert.ok(match, id+' is embedded');
    vm.runInNewContext(match[1],context);
  }
  return {c:context.ApocalypseCore,m:context.ApocalypseModems,createMT63:context.createMT63Module};
}
const {c,m,createMT63}=load();

test('hello-fm.html reconstructs all eight MT63 packets at 48 kHz',async()=>{
  const html=fs.readFileSync('hello-fm.html','utf8');
  const frames=c.makeTransfer(c.importHtml(html,'hello-fm.html'),0x1d71d9d7);
  assert.equal(frames.length,8);
  const receiver=await roundTrip('mt63',frames,48000);
  assert.equal(receiver.progress().received,8);
  assert.equal(new TextDecoder().decode(receiver.site.files[0].bytes),html);
});

async function roundTrip(id,frames,rate,transform) {
  const receiver=new c.TransferReceiver();
  const encoder=await m.createEncoder(id,frames,rate,false);
  const decoder=await m.createDecoder(id,rate,f=>receiver.acceptFrame(f));
  const total=Math.ceil(encoder.duration()*rate);
  let at=0;
  try {
    // Irregular callback sizes exercise symbol/sample state across boundaries.
    for(let sizeIndex=0;at<total;sizeIndex++) {
      const block=new Float32Array(Math.min([4096,997,2048][sizeIndex%3],total-at));
      encoder.fill(block);if(transform)transform(block,at);decoder.feed(block);at+=block.length;
    }
    // A live microphone continues to deliver samples after the last tone.
    for(let i=0;i<Math.ceil(rate/1024);i++)decoder.feed(new Float32Array(1024));
    return receiver;
  } finally {encoder.dispose?.();decoder.dispose?.();}
}

test('all protocols reconstruct a complete page', async () => {
  const site=c.importHtml('<h1>Three modems</h1>');
  const frames=c.makeTransfer(site,0x12345678);
  for(const id of Object.keys(m.PROTOCOLS)) {
    const receiver=await roundTrip(id,frames,id==='ax25'?48000:8000);
    assert.ok(receiver.site, id+' reconstructs site');
    assert.equal(new TextDecoder().decode(receiver.site.files[0].bytes),'<h1>Three modems</h1>');
  }
});

test('new modems handle 44.1/48 kHz, low gain, noise and echo', async () => {
  const frames=c.makeTransfer(c.importHtml('Hi'),987);
  for(const id of ['mt63','mfsk'])for(const rate of [44100,48000]) {
    const echo=new Float32Array(Math.round(rate*.009));let cursor=0;
    const receiver=await roundTrip(id,frames,rate,(block,at)=>{
      for(let i=0;i<block.length;i++){
        const clean=block[i];block[i]=clean*.15+echo[cursor]*.035+Math.sin((at+i)*.593)*.003;
        echo[cursor]=clean;cursor=(cursor+1)%echo.length;
      }
    });
    assert.ok(receiver.site,`${id} at ${rate}`);
  }
});

test('four-tone FEC corrects adjacent bit errors after interleaving', () => {
  const data=Uint8Array.from({length:256},(_,i)=>i);
  const symbols=m.fecSymbols(data);
  for(let i=0;i<symbols.length;i+=28)symbols[i]^=3;
  assert.deepEqual(Array.from(m.unfec(symbols)),Array.from(data));
});

test('MT63 records tolerate fragmentation and reject damaged frames', () => {
  const frame=c.createFrame(Uint8Array.of(1,2,3));let found=[];
  const events=[],parser=new m.TextFrames(f=>found.push(f),event=>events.push(event));
  const text=m.mt63Text(frame);
  for(const ch of text)parser.feed(ch);
  assert.equal(found.length,1);
  frame[18]^=1;
  parser.feed(m.mt63Text(frame));parser.feed('x'.repeat(5000));
  assert.equal(found.length,1);assert.ok(parser.pending.length<=400);
  assert.equal(events.length,1);assert.equal(events[0].level,'WARNING');assert.match(events[0].message,/checksum/);
});

test('MT63 waveform decodes through the reference modem API in 2000L mode', async () => {
  const frame=c.createFrame(Uint8Array.of(42,73,91));
  const encoder=await m.createEncoder('mt63',[frame],8000,false);
  const reference=await createMT63();reference._initRx(2000,1,16,5);
  const process=reference.cwrap('processAudio','string',['number','number']);
  const ptr=reference._malloc(4096);let text='';
  const length=Math.ceil(encoder.duration()*8000);
  try {
    for(let at=0;at<length+8000;at+=1024){const block=new Float32Array(1024);encoder.fill(block);reference.HEAPF32.set(block,ptr/4);text+=process(ptr,1024);}
    let received=null;new m.TextFrames(f=>received=f).feed(text);
    assert.deepEqual(Array.from(received||[]),Array.from(frame));
    assert.match(text,/~APW1:/);
  } finally {reference._free(ptr);encoder.dispose();}
});

test('sample-rate conversion is invariant to input callback boundaries', () => {
  for(const rate of [44100,48000]) {
    const samples=Float32Array.from({length:rate},(_,i)=>Math.sin(2*Math.PI*1900*i/rate));
    const whole=new m.Resampler(rate,8000).feed(samples);
    const streaming=new m.Resampler(rate,8000),parts=[];
    for(let i=0;i<samples.length;i+=997)parts.push(...streaming.feed(samples.subarray(i,i+997)));
    assert.equal(parts.length,whole.length);
    for(let i=0;i<whole.length;i++)assert.ok(Math.abs(parts[i]-whole[i])<1e-5);
  }
});

test('unknown protocols fail explicitly', async () => {
  await assert.rejects(m.createEncoder('unknown',[new Uint8Array(18)],8000),/Unknown protocol/);
  await assert.rejects(m.createDecoder('unknown',8000,()=>{}),/Unknown protocol/);
});

test('new modems recover multi-packet pages across repeats', async () => {
  const html='Repeated radio page. '.repeat(13),frames=c.makeTransfer(c.importHtml(html),741);
  assert.ok(frames.length>1);
  for(const id of ['mt63','mfsk']) {
    const receiver=await roundTrip(id,[...frames.slice(1),...frames],8000);
    assert.ok(receiver.site,id);
    assert.equal(new TextDecoder().decode(receiver.site.files[0].bytes),html);
    assert.equal(receiver.progress().received,frames.length);
  }
});

test('a mismatched modem does not accept an AX.25 transmission', async () => {
  const audio=c.encodeAudio([c.createFrame(Uint8Array.of(1,2,3))],48000);
  for(const id of ['mt63','mfsk']) {
    let frames=0;const decoder=await m.createDecoder(id,48000,()=>frames++);
    try {for(let at=0;at<audio.length;at+=1024)decoder.feed(audio.subarray(at,at+1024));assert.equal(frames,0,id);}
    finally {decoder.dispose();}
  }
});

test('MT63 sends an 11-packet page continuously at microphone sample rates', async () => {
  const html='<h1>MT63 regression</h1>'.padEnd(1550,' ');
  const frames=c.makeTransfer(c.importHtml(html,'hello-fm.html'),0x12345678);
  assert.equal(frames.length,11);
  assert.equal(m.mt63Bursts(frames).length,1,'one acquisition per pass, not per packet');
  assert.ok(m.duration('mt63',frames)<160,'less than the previous 254-second pass');
  for(const rate of [44100,48000]){
    const receiver=await roundTrip('mt63',frames,rate);
    assert.equal(receiver.progress().received,11);
    assert.equal(new TextDecoder().decode(receiver.site.files[0].bytes),html);
  }
});

test('MT63 keeps recoverable characters when the old signal-quality gate would drop them', async () => {
  // A recorded deterministic synthetic channel: legacy per-packet transmission,
  // white noise and a 20 ms echo. Compare gating with the same reference modem.
  const frames=c.makeTransfer(c.importHtml('Test packet contents. '.repeat(28)),871);
  const tx=await createMT63(),encode=tx.cwrap('encodeString','number',['string','number','number']);
  const open=new c.TransferReceiver(),gated=new c.TransferReceiver();
  const decoder=await m.createDecoder('mt63',8000,f=>open.acceptFrame(f));
  const legacy=await m.createDecoder('mt63',8000,f=>gated.acceptFrame(f));legacy.module._initRx(2000,1,16,5);
  let seed=17;const echo=new Float32Array(160);let at=0;
  try{
    const parts=[];
    for(const frame of frames){const length=encode(m.mt63Text(frame),2000,1),ptr=tx._getBuffer();parts.push(tx.HEAPF32.slice(ptr/4,ptr/4+length));}
    const input=new Float32Array(parts.reduce((n,p)=>n+p.length,0)+16000);let offset=0;
    for(const part of parts){input.set(part,offset);offset+=part.length;}
    for(let i=0;i<offset;i++){
      const clean=input[i];seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      input[i]=clean+(seed/4294967296*2-1)+(i>160?echo[at]*.4:0);echo[at]=clean;at=(at+1)%160;
    }
    for(let i=0;i<input.length;i+=1024){const block=input.subarray(i,i+1024);decoder.feed(block);legacy.feed(block);}
    assert.ok(open.progress().received>gated.progress().received,`open ${open.progress().received}, gated ${gated.progress().received}`);
    assert.ok(decoder.diagnostics().rejected>0,'damaged records still fail checksums');
  }finally{decoder.dispose();legacy.dispose();}
});

test('MT63 bounds long transfers below the native ten-minute encode buffer', () => {
  const frame=c.createFrame(new Uint8Array(256));
  const bursts=m.mt63Bursts(Array(100).fill(frame));
  assert.ok(bursts.length>1);
  assert.equal(bursts.reduce((n,text)=>n+(text.match(/~APW1:/g)||[]).length,0),100);
  for(const text of bursts)assert.ok(1.984+(text.length+65)/20<600);
});

test('live MT63 repeating reuses rendered audio and delivers a second complete pass', async () => {
  const frames=c.makeTransfer(c.importHtml('Repeat'),125),encoder=await m.createEncoder('mt63',frames,8000,true);
  let nativeCalls=0;const nativeEncode=encoder.encode;encoder.encode=(...args)=>{nativeCalls++;return nativeEncode(...args);};
  let packets=0;const decoder=await m.createDecoder('mt63',8000,()=>packets++);
  try{
    const block=new Float32Array(1024);
    for(let at=0;at<encoder.duration()*8000*2+8000;at+=1024){encoder.fill(block);decoder.feed(block);}
    assert.equal(nativeCalls,0,'no native encoding in repeated single-burst audio callbacks');
    assert.ok(packets>=frames.length*2);
  }finally{encoder.dispose();decoder.dispose();}
});

test('MT63 noise output never advances page reception without validated packets', async () => {
  const receiver=new c.TransferReceiver();let rawCharacters=0,seed=17;
  const decoder=await m.createDecoder('mt63',8000,frame=>receiver.acceptFrame(frame),event=>{if(event.text)rawCharacters+=event.text.length;});
  try{
    for(let at=0;at<8000*45;at+=1024){
      const samples=new Float32Array(1024);
      if(at<8000*30)for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=(seed/4294967296*2-1)*.1;}
      decoder.feed(samples);
    }
    assert.ok(rawCharacters>0,'the ungated decoder can produce unverified characters from noise');
    assert.equal(receiver.progress().received,0);
    assert.equal(receiver.progress().total,0);
    assert.equal(receiver.site,null);
  }finally{decoder.dispose();}
});

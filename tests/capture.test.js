const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function load(extra={}){
  const context={Float32Array,performance,...extra};
  vm.runInNewContext(fs.readFileSync('src/capture.js','utf8'),context);
  return context.ApocalypseCapture;
}
test('worklet preserves sample order, variable quantum sizes and capture timestamps',()=>{
  const messages=[];let Processor;
  const context={Float32Array,currentFrame:1000,
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>messages.push(data)};}},
    registerProcessor:(_,type)=>Processor=type};
  vm.runInNewContext(load().workletSource,context);
  const processor=new Processor();let count=0;
  for(let i=0;i<100;i++){
    const samples=Float32Array.from({length:[128,256,96][i%3]},()=>count++);
    assert.equal(processor.process([[samples]]),true);context.currentFrame+=samples.length;
  }
  assert.ok(messages.length>2);
  messages.forEach((message,index)=>{
    assert.equal(message.frame,1000+index*4096);
    assert.deepEqual(Array.from(message.samples),Array.from({length:4096},(_,i)=>index*4096+i));
  });
});
test('fallback reports missing audio and is disconnected on stop',async()=>{
  const events=[],blocks=[];let disconnected=false;
  const node={disconnect(){disconnected=true;}};
  const context={sampleRate:48000,currentTime:0,createScriptProcessor:()=>node};
  const capture=load();await capture.create(context,b=>blocks.push(b),(level,message)=>events.push({level,message}));
  const samples=new Float32Array(4096);
  for(const frame of [4096,8192,16384])node.onaudioprocess({playbackTime:frame/48000,inputBuffer:{getChannelData:()=>samples}});
  assert.equal(blocks.length,3);
  assert.ok(events.some(e=>e.message.includes('fallback')));
  assert.ok(events.some(e=>e.message.includes('4096 samples missing')));
  capture.dispose(node);assert.equal(node.onaudioprocess,null);assert.equal(disconnected,true);
});
test('worklet backlog is diagnosed without dropping queued samples; stop closes port',async()=>{
  let node;const events=[],blocks=[];
  const capture=load({
    AudioWorkletNode:class{constructor(context,name,options){assert.equal(options.numberOfOutputs,0);node=this;this.port={close(){this.closed=true;}};}disconnect(){this.disconnected=true;}}});
  const context={sampleRate:48000,currentTime:5,audioWorklet:{addModule:async()=>{}}};
  await capture.create(context,b=>blocks.push(b),(level,message)=>events.push({level,message}));
  for(let i=0;i<3;i++)node.port.onmessage({data:{frame:i*4096,samples:new Float32Array(4096)}});
  assert.equal(blocks.length,3);
  assert.equal(events.filter(e=>e.message.includes('behind capture')).length,1);
  assert.ok(!events.some(e=>e.message.includes('Capture gap')));
  capture.dispose(node);assert.equal(node.port.onmessage,null);assert.equal(node.port.closed,true);assert.equal(node.disconnected,true);
});

test('timing diagnostics detect a slow audio clock even without capture gaps or queue backlog',async()=>{
  let now=0,node;const events=[];
  const capture=load({performance:{now:()=>now},AudioWorkletNode:class{constructor(){node=this;this.port={};}}});
  const context={sampleRate:48000,currentTime:0,audioWorklet:{addModule:async()=>{}}};
  await capture.create(context,()=>{},(level,message)=>events.push({level,message}));
  for(let i=0;i<=130;i++){
    now=i*128;context.currentTime=(i+1)*4096/48000;
    node.port.onmessage({data:{frame:i*4096,samples:new Float32Array(4096)}});
  }
  assert.ok(events.some(e=>e.message.includes('67% of real time')));
  assert.ok(!events.some(e=>e.message.includes('Capture gap')||e.message.includes('behind capture')));
});

test('healthy microphone timing uses the concise status',async()=>{
  let now=0,node;const events=[];
  const capture=load({performance:{now:()=>now},AudioWorkletNode:class{constructor(){node=this;this.port={};}}});
  const context={sampleRate:48000,currentTime:0,audioWorklet:{addModule:async()=>{}}};
  await capture.create(context,()=>{},(level,message)=>events.push({level,message}));
  for(let i=0;i<=120;i++){
    now=i*4096/48;context.currentTime=(i+1)*4096/48000;
    node.port.onmessage({data:{frame:i*4096,samples:new Float32Array(4096)}});
  }
  assert.ok(events.some(e=>e.level==='INFO'&&e.message==='Microphone capture check working'));
  assert.ok(!events.some(e=>e.level==='WARNING'));
});

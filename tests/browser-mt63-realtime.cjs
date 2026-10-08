// Real-time browser regression: full WAV -> independent MediaStream clock ->
// actual receive UI and AudioWorklet. No physical microphone or speaker audio.
// Start isolated Chrome/Edge with remote debugging on port 9230.
// Optional --compare-legacy also runs the previous muted-output graph.
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const targets=await(await fetch('http://127.0.0.1:9230/json')).json();
  const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>ws.onopen=resolve);
  let id=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m));ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  const wait=async expression=>{for(let i=0;i<300;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+expression);};
  try{
    await call('Page.navigate',{url:pathToFileURL(path.resolve('index.html')).href});
    await wait('typeof ApocalypseCapture === "object"');
    await evaluate(`(()=>{
      window.testDownloads=[];
      HTMLAnchorElement.prototype.click=function(){if(this.download)testDownloads.push(this.href);};
      const s=document.getElementById('protocol');s.value='mt63';s.dispatchEvent(new Event('change'));
      const text='<h1>Real-time MT63</h1>'+'Radio '.repeat(190),bytes=new TextEncoder().encode(text);
      window.testExpectedPackets=ApocalypseCore.makeFileTransfer({name:'realtime.html',type:'text/html',bytes},1).length;
      const transfer=new DataTransfer();transfer.items.add(new File([bytes],'realtime.html',{type:'text/html'}));
      const input=document.getElementById('file');input.files=transfer.files;input.dispatchEvent(new Event('change'));
    })()`);
    await wait('!document.getElementById("download").disabled');
    await evaluate('document.getElementById("download").click()');
    await wait('testDownloads.length>0');
    const duration=await evaluate(`(async()=>{
      const wav=await(await fetch(testDownloads[0])).arrayBuffer();
      // A MediaStream destination is automatically pulled. The transmitter
      // has its own clock and never connects to the speaker destination.
      window.testTxContext=new AudioContext({sampleRate:48000});await testTxContext.resume();
      const buffer=await testTxContext.decodeAudioData(wav);
      window.testTx=testTxContext.createBufferSource();testTx.buffer=buffer;
      window.testDestination=testTxContext.createMediaStreamDestination();testTx.connect(testDestination);
      navigator.mediaDevices.getUserMedia=async()=>testDestination.stream.clone();
      window.testSamples=0;window.testRxContext=null;
      const create=ApocalypseCapture.create;
      ApocalypseCapture.create=async(context,onSamples,onEvent)=>{
        testRxContext=context;
        const node=await create(context,samples=>{testSamples+=samples.length;onSamples(samples);},onEvent);
        if(node.numberOfOutputs!==0)throw Error('Receiver must be capture-only');return node;
      };
      document.getElementById('receiveTab').click();document.getElementById('receive').click();return buffer.duration;
    })()`);
    await wait('document.getElementById("status-mt63").textContent==="Listening for packets."');
    if(process.argv.includes('--compare-legacy'))await evaluate(`(async()=>{
      const context=window.legacyContext=new AudioContext({sampleRate:48000});await context.resume();
      await context.audioWorklet.addModule('data:text/javascript,'+encodeURIComponent(ApocalypseCapture.workletSource));
      window.legacyReceiver=new ApocalypseCore.EnhancedTransferReceiver();
      window.legacyDecoder=await ApocalypseModems.createDecoder('mt63',context.sampleRate,f=>legacyReceiver.acceptFrame(f));
      window.legacySamples=0;
      window.legacyNode=new AudioWorkletNode(context,'packet-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
      legacyNode.port.onmessage=e=>{legacySamples+=e.data.samples.length;legacyDecoder.feed(e.data.samples);};
      context.createMediaStreamSource(testDestination.stream.clone()).connect(legacyNode).connect(context.destination);
    })()`);
    await evaluate('window.testStart=performance.now();window.testStartSamples=testSamples;window.testStartClock=testRxContext.currentTime;testTx.start()');
    console.log('Sending realtime.html through a real-time MediaStream for '+duration.toFixed(2)+' seconds');
    let result;
    for(let second=0;second<Math.ceil(duration)+5;second++){
      await delay(1000);
      result=await evaluate(`({wall:(performance.now()-testStart)/1000,audio:(testSamples-testStartSamples)/testRxContext.sampleRate,clock:testRxContext.currentTime-testStartClock,received:document.getElementById('progress-mt63').value,total:document.getElementById('progress-mt63').max,expected:testExpectedPackets,status:document.getElementById('status-mt63').textContent,files:document.getElementById('receivedList').children.length,legacy:window.legacyReceiver?{received:legacyReceiver.progress().received,audio:legacySamples/legacyContext.sampleRate}:null})`);
      if(second%15===0)console.log(JSON.stringify(result));
      if(result.wall>40)assert.ok(Math.abs(result.audio-result.wall)<1.5,'Capture clock drift: '+JSON.stringify(result));
      if(result.wall>=duration+2)break;
    }
    assert.equal(result.total,result.expected);assert.equal(result.received,result.expected,JSON.stringify(result));assert.match(result.status,/complete/i);assert.equal(result.files,1);
    assert.ok(result.wall>60,'Must run beyond the 30-second silent-output transition');
    console.log('PASS: full real-time transfer: '+JSON.stringify(result));
    await evaluate(`document.getElementById('stopReceive').click();testTxContext.close();if(window.legacyContext){ApocalypseCapture.dispose(legacyNode);legacyDecoder.dispose();legacyContext.close();}`);
  }finally{await call('Browser.close');ws.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

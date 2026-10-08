// Run against an isolated Chrome instance with --remote-debugging-port=9227
// and --autoplay-policy=no-user-gesture-required --disable-popup-blocking.
// No microphone is accessed; blocked tabs are also simulated explicitly.
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

(async()=>{
  const targets=await (await fetch('http://127.0.0.1:9227/json')).json();
  const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>ws.onopen=resolve);
  let id=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m));ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
  const wait=async expression=>{for(let i=0;i<300;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);};
  try {
    await call('Page.navigate',{url:pathToFileURL(path.resolve('apocalipse.html')).href});
    await wait('typeof ApocalypseModems === "object" && !!document.getElementById("protocol")');
    assert.equal(await evaluate('!document.getElementById("transmitPanel").hidden && document.getElementById("receivePanel").hidden'),true);
    await evaluate('document.getElementById("transmitTab").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
    assert.equal(await evaluate('document.activeElement.id==="receiveTab" && !document.getElementById("receivePanel").hidden'),true);
    // Exercise the real rendering-thread capture while the page is blocked.
    const capture=await evaluate(`(async()=>{
      const context=new AudioContext({sampleRate:48000});await context.resume();
      const events=[],blocks=[];
      const node=await ApocalypseCapture.create(context,(samples)=>blocks.push(samples), (level,message)=>events.push({level,message}));
      const source=context.createConstantSource();source.offset.value=.25;
      if(node.numberOfOutputs!==0)throw Error('Capture must not depend on a speaker output');
      source.connect(node);source.start();
      await new Promise(r=>setTimeout(r,200));
      const start=performance.now();while(performance.now()-start<1200){}
      await new Promise(r=>setTimeout(r,300));
      source.stop();ApocalypseCapture.dispose(node);await context.close();
      return {events,count:blocks.reduce((n,b)=>n+b.length,0),correct:blocks.every(b=>b.every(x=>Math.abs(x-.25)<1e-6))};
    })()`);
    assert.ok(capture.events.some(e=>e.message.startsWith('Capture: AudioWorklet')),JSON.stringify(capture));
    assert.ok(capture.count>48000*1.4,JSON.stringify(capture));
    assert.equal(capture.correct,true);
    assert.ok(!capture.events.some(e=>e.message.startsWith('Capture gap:')),JSON.stringify(capture));
    console.log('Real AudioWorklet retains microphone samples across a 1.2-second main-thread stall');
    await evaluate(`(()=>{
      window.testNodes=[];window.testStreams=[];window.testDownloads=[];window.testContexts=[];window.testReceivers=[];
      window.testTabs=[];window.testOpenCalls=0;window.testBlockTabs=false;
      const open=window.open.bind(window);
      window.open=(...args)=>{testOpenCalls++;if(testBlockTabs)return null;const tab=open(...args);if(tab)testTabs.push(tab);return tab;};
      const capture=ApocalypseCapture.create;
      ApocalypseCapture.create=async(context,onSamples,onEvent)=>{
        const node=await capture(context,onSamples,onEvent);testReceivers.push({node,onSamples});return node;
      };
      const create=AudioContext.prototype.createScriptProcessor;
      AudioContext.prototype.createScriptProcessor=function(...args){const node=create.apply(this,args);testNodes.push(node);return node;};
      navigator.mediaDevices.getUserMedia=async()=>{
        const context=new AudioContext(),source=context.createConstantSource(),destination=context.createMediaStreamDestination();
        source.offset.value=0;source.connect(destination);source.start();await context.resume();testContexts.push(context);testStreams.push(destination.stream);return destination.stream;
      };
      HTMLAnchorElement.prototype.click=function(){if(this.download)testDownloads.push({name:this.download,url:this.href});};
    })()`);
    const doc=await call('DOM.getDocument');
    const input=await call('DOM.querySelector',{nodeId:doc.result.root.nodeId,selector:'#file'});
    await call('DOM.setFileInputFiles',{nodeId:input.result.nodeId,files:[path.resolve('tests/fixtures/radio.html')]});
    await wait('!document.getElementById("download").disabled');
    const durations=[];
    for(const protocol of ['ax25','mt63','mfsk']) {
      await evaluate('document.getElementById("clearConsole").click()');
      await evaluate(`(()=>{const s=document.getElementById('protocol');s.value='${protocol}';s.dispatchEvent(new Event('change'));})()`);
      const sourceStatus=await evaluate('document.getElementById("sourceStatus").textContent');durations.push(sourceStatus);
      assert.match(sourceStatus,new RegExp(({ax25:'AX.25',mt63:'MT63-2000L',mfsk:'multi-tone FSK'})[protocol]));
      const before=await evaluate('testDownloads.length');
      await evaluate('document.getElementById("download").click()');
      await wait(`testDownloads.length>${before} && !document.getElementById('download').disabled`);
      const wav=await evaluate(`(async()=>{
        const download=testDownloads.at(-1),bytes=await (await fetch(download.url)).arrayBuffer(),view=new DataView(bytes);
        const rate=view.getUint32(24,true),channels=view.getUint16(22,true);
        window.testAudio=await new OfflineAudioContext(1,1,48000).decodeAudioData(bytes);
        return {name:download.name,rate,channels,duration:testAudio.duration};
      })()`);
      assert.equal(wav.name,'apocalipse-web-'+protocol+'.wav');assert.equal(wav.rate,protocol==='ax25'?12000:8000);assert.equal(wav.channels,1);
      await evaluate('document.getElementById("receive").click()');
      await wait('document.getElementById("rxStatus").textContent.startsWith("Listening for")');
      await evaluate('document.getElementById("transmitTab").click();document.getElementById("receiveTab").click()');
      assert.equal(await evaluate('testStreams.at(-1).getTracks().every(t=>t.readyState==="live") && !document.getElementById("stopReceive").disabled'),true);
      await evaluate(`window.testBlockTabs=${protocol==='mt63'};window.openCallsBefore=testOpenCalls;`);
      const result=await evaluate(`(()=>{
        const receiver=testReceivers.at(-1),samples=testAudio.getChannelData(0);
        for(let at=0;at<samples.length+48000;at+=4096){const b=new Float32Array(4096);b.set(samples.subarray(at,at+4096));receiver.onSamples(b);}
        return {status:document.getElementById('rxStatus').textContent,previewButton:!!document.getElementById('previewReceived'),progress:document.getElementById('progress').value,total:document.getElementById('progress').max};
      })()`);
      assert.match(result.status,/complete:/i,protocol);assert.equal(result.previewButton,false);assert.equal(result.progress,result.total);
      assert.equal(await evaluate('testOpenCalls-openCallsBefore'),1,'one new-tab attempt per completed transfer');
      assert.equal(await evaluate('document.getElementById("preview").srcdoc'),'', 'received pages do not use the in-page preview');
      if(protocol==='mt63'){
        assert.equal(await evaluate('document.getElementById("openReceived").hidden'),false);
        await evaluate('testBlockTabs=false;document.getElementById("openReceived").click()');
      }
      await wait('testTabs.at(-1)?.document.querySelector("iframe")?.contentDocument?.body?.textContent.includes("Radio")');
      assert.equal(await evaluate('document.getElementById("openReceived").hidden'),true);
      assert.equal(await evaluate('testTabs.at(-1).opener===null'),true);
      await wait('!!document.querySelector("#consoleLog .log-success")');
      const logs=await evaluate(`(()=>{const box=document.getElementById('consoleLog');return {text:box.textContent,html:box.querySelector('h1,img,script')!==null,timestamps:[...box.querySelectorAll('time')].every(t=>Number.isFinite(Date.parse(t.dateTime))),bottom:Math.abs(box.scrollHeight-box.clientHeight-box.scrollTop)<2};})()`);
      assert.match(logs.text,/frame bytes:/);assert.match(logs.text,/Packet 1\//);assert.match(logs.text,/\[DATA\]/);assert.equal(logs.html,false);assert.equal(logs.timestamps,true);assert.equal(logs.bottom,true);
      if(protocol==='mt63'){
        assert.match(logs.text,/\[RAW\].*Unverified decoder text:/);
        const exported=await evaluate(`(async()=>{document.getElementById('downloadConsole').click();const d=testDownloads.at(-1);return {name:d.name,text:await (await fetch(d.url)).text()};})()`);
        assert.match(exported.name,/^apocalipse-console-mt63-.*\.txt$/);
        assert.match(exported.text,/Selected protocol: MT63-2000L/);
        assert.match(exported.text,/\[RAW\] \[MT63\] Unverified decoder text:/);
        assert.match(exported.text,/FCS-validated frame bytes:/);
        assert.match(exported.text,/Capture settings:/);
      }
      // A repeated pass must not open another tab or reload the existing one.
      const repeated=await evaluate(`(()=>{
        const before=testOpenCalls,tab=testTabs.at(-1),doc=tab.document.querySelector('iframe').contentDocument;
        const receiver=testReceivers.at(-1),samples=testAudio.getChannelData(0);
        for(let at=0;at<samples.length+48000;at+=4096){const b=new Float32Array(4096);b.set(samples.subarray(at,at+4096));receiver.onSamples(b);}
        return before===testOpenCalls&&doc===tab.document.querySelector('iframe').contentDocument;
      })()`);
      assert.equal(repeated,true);
      await evaluate('document.getElementById("previewSource").click()');
      await wait('document.getElementById("preview").contentDocument?.body?.textContent.includes("Radio")');
      await evaluate('testTabs.at(-1).close()');
      // Changing modes must stop the microphone and clear completion.
      await evaluate(`(()=>{const s=document.getElementById('protocol');s.value='${protocol==='ax25'?'mfsk':'ax25'}';s.dispatchEvent(new Event('change'));})()`);
      const stopped=await evaluate(`({tracks:testStreams.at(-1).getTracks().every(t=>t.readyState==='ended'),callback:testReceivers.at(-1).node.port.onmessage===null,progress:document.getElementById('progress').value,previewEmpty:document.getElementById('preview').srcdoc===''})`);
      assert.deepEqual(stopped,{tracks:true,callback:true,progress:0,previewEmpty:true});
      // Exercise real live transmission setup and cancellation as well.
      await evaluate(`(()=>{const s=document.getElementById('protocol');s.value='${protocol}';s.dispatchEvent(new Event('change'));document.getElementById('transmit').click();})()`);
      await wait('testNodes.at(-1)?.onaudioprocess !== null && !document.getElementById("stopTransmit").disabled');
      await evaluate('document.getElementById("transmitTab").click();document.getElementById("receiveTab").click()');
      assert.equal(await evaluate('testNodes.at(-1).onaudioprocess!==null && !document.getElementById("stopTransmit").disabled'),true);
      await evaluate('document.getElementById("protocol").dispatchEvent(new Event("change"))');
      assert.equal(await evaluate('testNodes.at(-1).onaudioprocess===null && document.getElementById("stopTransmit").disabled'),true);
      console.log(protocol+': WAV '+wav.duration.toFixed(2)+' s, microphone decoding, preview, and mode-switch cleanup passed');
    }
    assert.equal(new Set(durations).size,3);
    // Cancellation while WASM initialization is pending must not download stale audio.
    await evaluate(`(()=>{
      const original=ApocalypseModems.createEncoder;
      ApocalypseModems.createEncoder=async(...args)=>{await new Promise(r=>setTimeout(r,100));return original(...args);};
      const s=document.getElementById('protocol');s.value='mt63';s.dispatchEvent(new Event('change'));
      window.downloadCount=testDownloads.length;document.getElementById('download').click();s.value='mfsk';s.dispatchEvent(new Event('change'));
    })()`);
    await new Promise(r=>setTimeout(r,300));
    assert.equal(await evaluate('testDownloads.length===downloadCount && !document.getElementById("download").disabled'),true);
    console.log('Pending WAV cancellation passed');
    await evaluate(`(()=>{
      ApocalypseModems.createDecoder=async()=>{throw Error('Test: decoder unavailable');};
      const s=document.getElementById('protocol');s.value='mt63';s.dispatchEvent(new Event('change'));
      document.getElementById('receive').click();
    })()`);
    await wait('document.getElementById("rxStatus").textContent==="Test: decoder unavailable"');
    assert.equal(await evaluate('!document.getElementById("receive").disabled && testStreams.at(-1).getTracks().every(t=>t.readyState==="ended")'),true);
    console.log('Decoder initialization failure releases microphone and restores controls');
    await wait('document.querySelector("#consoleLog .log-error")?.textContent.includes("decoder unavailable")');
    await evaluate(`(()=>{
      document.getElementById('clearConsole').click();
      for(let i=0;i<550;i++)window.dispatchEvent(new ErrorEvent('error',{message:'Test log '+i+' <img id="unsafe-log-html">'}));
    })()`);
    await wait('document.getElementById("consoleLog").children.length===500');
    assert.equal(await evaluate('document.getElementById("unsafe-log-html")===null'),true);
    const exportedAll=await evaluate(`(async()=>{window.dispatchEvent(new ErrorEvent('error',{message:'Unflushed export entry'}));document.getElementById('downloadConsole').click();return await (await fetch(testDownloads.at(-1).url)).text();})()`);
    assert.match(exportedAll,/Entries: 551/);
    assert.match(exportedAll,/Test log 0 /);
    assert.match(exportedAll,/Test log 549 /);
    assert.match(exportedAll,/Unflushed export entry/);
    await evaluate(`(()=>{const follow=document.getElementById('consoleFollow');follow.checked=false;follow.dispatchEvent(new Event('change'));document.getElementById('consoleLog').scrollTop=0;window.dispatchEvent(new ErrorEvent('error',{message:'Paused scroll check'}));})()`);
    await wait('document.getElementById("consoleLog").lastElementChild.textContent.includes("Paused scroll check")');
    assert.equal(await evaluate('document.getElementById("consoleLog").scrollTop'),0);
    await evaluate(`(()=>{const follow=document.getElementById('consoleFollow');follow.checked=true;follow.dispatchEvent(new Event('change'));})()`);
    assert.equal(await evaluate('(()=>{const b=document.getElementById("consoleLog");return Math.abs(b.scrollHeight-b.clientHeight-b.scrollTop)<2;})()'),true);
    await evaluate('document.getElementById("clearConsole").click()');
    assert.equal(await evaluate('document.getElementById("consoleLog").children.length'),0);
    const clearedExport=await evaluate(`(async()=>{document.getElementById('downloadConsole').click();return await (await fetch(testDownloads.at(-1).url)).text();})()`);
    assert.match(clearedExport,/Entries: 0/);assert.doesNotMatch(clearedExport,/Test log|Unflushed export entry/);
    console.log('Console timestamps, raw receive data, error tags, safe text, retention, clear and auto-scroll passed');
    console.log('Full console export includes entries beyond the visible limit, pending entries, and MT63 diagnostics; Clear resets exported history');
    await call('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
    console.log('Mobile layout has no horizontal overflow');
  } finally {await call('Browser.close');ws.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

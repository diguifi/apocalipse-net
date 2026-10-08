// Run against an isolated Chromium/Edge instance on remote debugging port 9229.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

(async()=>{
  const targets=await (await fetch('http://127.0.0.1:9229/json')).json();
  const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>ws.onopen=resolve);
  let serial=0;const pending=new Map();
  ws.onmessage=e=>{const msg=JSON.parse(e.data);if(pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,msg=>msg.error?reject(Error(JSON.stringify(msg.error))):resolve(msg));ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.result.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));return result.result.result.value;};
  const wait=async expression=>{for(let i=0;i<400;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);};
  try{
    await call('Page.navigate',{url:pathToFileURL(path.resolve('index.html')).href});
    await wait('typeof ApocalypseCore === "object" && typeof ApocalypseModems === "object"');
    const capture=await evaluate(`(async()=>{
      const context=new AudioContext({sampleRate:48000});await context.resume();
      const events=[],blocks=[];
      const node=await ApocalypseCapture.create(context,samples=>blocks.push(samples),(level,message)=>events.push({level,message}));
      const source=context.createConstantSource();source.offset.value=.25;
      if(node.numberOfOutputs!==0)throw Error('Capture must not depend on a speaker output');
      source.connect(node);source.start();
      await new Promise(resolve=>setTimeout(resolve,200));
      const start=performance.now();while(performance.now()-start<1200){}
      await new Promise(resolve=>setTimeout(resolve,300));
      source.stop();ApocalypseCapture.dispose(node);await context.close();
      return {events,count:blocks.reduce((n,b)=>n+b.length,0),correct:blocks.every(b=>b.every(x=>Math.abs(x-.25)<1e-6))};
    })()`);
    assert.ok(capture.events.some(event=>event.message.startsWith('Capture: AudioWorklet')),JSON.stringify(capture));
    assert.ok(capture.count>48000*1.4,JSON.stringify(capture));
    assert.equal(capture.correct,true);
    assert.ok(!capture.events.some(event=>event.message.startsWith('Capture gap:')),JSON.stringify(capture));
    assert.deepEqual(await evaluate(`(()=>{const selector=document.getElementById('protocol');return {selected:selector.value,options:[...selector.options].map(option=>option.value),fileDisabled:document.getElementById('file').disabled,textDisabled:document.getElementById('plainText').disabled,generateDisabled:document.getElementById('generateText').disabled,volumeDisabled:document.getElementById('volume').disabled,fileInert:document.getElementById('fileSection').inert,textInert:document.getElementById('textSection').inert,audioInert:document.getElementById('audioSection').inert,transmitDisabled:document.getElementById('transmit').disabled,wavDisabled:document.getElementById('download').disabled};})()`),{selected:'',options:['','mt63','ax25','mfsk'],fileDisabled:true,textDisabled:true,generateDisabled:true,volumeDisabled:true,fileInert:true,textInert:true,audioInert:true,transmitDisabled:true,wavDisabled:true});
    assert.equal(await evaluate(`document.getElementById('selectAllReceived').disabled&&document.getElementById('deselectAllReceived').disabled&&document.getElementById('downloadSelected').disabled&&document.getElementById('removeSelected').disabled&&document.getElementById('receivedList').children.length===0`),true);
    assert.equal(await evaluate(`(()=>{const panel=document.getElementById('transmitPanel'),sections=[...panel.querySelectorAll(':scope > section')],rects=sections.map(section=>section.getBoundingClientRect());return sections.length===4&&sections[0].contains(document.getElementById('protocol'))&&sections[1].contains(document.getElementById('file'))&&sections[2].contains(document.getElementById('plainText'))&&sections[3].querySelector('#volume')!==null&&rects[0].width>rects[1].width&&rects[1].top>=rects[0].bottom&&rects[2].top===rects[1].top&&rects[3].top>=Math.max(rects[1].bottom,rects[2].bottom);})()`),true);
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('receivePanel')).display`),'none');
    await evaluate(`document.getElementById('receiveTab').click()`);
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('transmitPanel')).display`),'none');
    assert.equal(await evaluate(`document.getElementById('protocol').getClientRects().length`),0);
    await evaluate(`document.getElementById('transmitTab').click()`);
    assert.notEqual(await evaluate(`getComputedStyle(document.getElementById('transmitPanel')).display`),'none');
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('receivePanel')).display`),'none');
    await evaluate(`(()=>{
      window.testDownloads=[];window.testReceivers=[];window.testStreams=[];
      const capture=ApocalypseCapture.create;
      ApocalypseCapture.create=async(context,onSamples,onEvent)=>{const node=await capture(context,onSamples,onEvent);testReceivers.push({node,onSamples});return node;};
      navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext(),source=context.createConstantSource(),destination=context.createMediaStreamDestination();source.offset.value=0;source.connect(destination);source.start();await context.resume();testStreams.push(destination.stream);return destination.stream;};
      HTMLAnchorElement.prototype.click=function(){if(this.download)testDownloads.push({name:this.download,url:this.href});};
    })()`);
    const standalone=await evaluate(`(async()=>{
      const button=document.getElementById('downloadApp');button.click();
      const item=testDownloads.find(download=>download.name==='index.html');
      const html=await(await fetch(item.url)).text();
      const copy=new DOMParser().parseFromString(html,'text/html');
      return {label:button.textContent,visible:button.getBoundingClientRect().width>0,doctype:copy.doctype?.name,core:copy.querySelector('#core')?.textContent.includes('ApocalypseCore'),modem:copy.querySelector('#mt63-runtime')?.textContent.includes('createMT63Module'),app:copy.querySelector('#app')?.textContent.includes('downloadApp'),source:copy.querySelector('#sourceBundle')?.href.startsWith('data:application/gzip;base64,')};
    })()`);
    assert.deepEqual(standalone,{label:'Download',visible:true,doctype:'html',core:true,modem:true,app:true,source:true});
    await evaluate(`(()=>{const selector=document.getElementById('protocol');selector.value='mt63';selector.dispatchEvent(new Event('change'));})()`);
    assert.equal(await evaluate(`!document.getElementById('file').disabled&&!document.getElementById('plainText').disabled&&!document.getElementById('volume').disabled&&!document.getElementById('fileSection').inert&&!document.getElementById('textSection').inert&&!document.getElementById('audioSection').inert`),true);
    const generated=await evaluate(`(()=>{const input=document.getElementById('plainText');input.value='Hello 🌐';input.dispatchEvent(new Event('input'));document.getElementById('generateText').click();return {status:document.getElementById('textStatus').textContent,fileStatus:document.getElementById('sourceStatus').textContent,wavEnabled:!document.getElementById('download').disabled,uploadValue:document.getElementById('file').value};})()`);
    assert.match(generated.status,/message\.txt · 10 bytes/);assert.equal(generated.fileStatus,'No file selected.');assert.equal(generated.wavEnabled,true);assert.equal(generated.uploadValue,'');
    assert.equal(await evaluate(`(()=>{const input=document.getElementById('plainText');input.value='Updated text';input.dispatchEvent(new Event('input'));return document.getElementById('download').disabled&&document.getElementById('textStatus').textContent==='Text changed. Generate again.';})()`),true);
    await evaluate(`document.getElementById('generateText').click()`);
    assert.equal(await evaluate(`!document.getElementById('download').disabled`),true);
    await evaluate(`(()=>{const selector=document.getElementById('protocol');selector.value='ax25';selector.dispatchEvent(new Event('change'));})()`);
    const textWavBefore=await evaluate('testDownloads.length');
    await evaluate(`document.getElementById('download').click()`);
    await wait(`testDownloads.length>${textWavBefore}&&!document.getElementById('download').disabled`);
    const textRoundTrip=await evaluate(`(async()=>{
      const wav=await(await fetch(testDownloads.at(-1).url)).arrayBuffer();
      const audio=await new OfflineAudioContext(1,1,48000).decodeAudioData(wav);
      const receiver=new ApocalypseCore.EnhancedTransferReceiver();
      const decoder=await ApocalypseModems.createDecoder('ax25',48000,frame=>receiver.acceptFrame(frame));
      const samples=audio.getChannelData(0);
      for(let at=0;at<samples.length+48000;at+=4096){const block=new Float32Array(4096);block.set(samples.subarray(at,at+4096));decoder.feed(block);}
      decoder.dispose?.();
      return receiver.completed?.kind==='file'?{name:receiver.completed.value.name,text:new TextDecoder().decode(receiver.completed.value.bytes)}:null;
    })()`);
    assert.deepEqual(textRoundTrip,{name:'message.txt',text:'Updated text'});
    await evaluate(`(()=>{const selector=document.getElementById('protocol');selector.value='mt63';selector.dispatchEvent(new Event('change'));})()`);
    const doc=await call('DOM.getDocument');
    const input=await call('DOM.querySelector',{nodeId:doc.result.root.nodeId,selector:'#file'});
    await call('DOM.setFileInputFiles',{nodeId:input.result.nodeId,files:[path.resolve('tests/fixtures/enhanced.txt')]});
    await wait('!document.getElementById("download").disabled');
    assert.equal(await evaluate(`document.getElementById('textStatus').textContent===''&&document.getElementById('sourceStatus').textContent.includes('enhanced.txt')`),true);
    await evaluate(`(()=>{const selector=document.getElementById('protocol');selector.value='';selector.dispatchEvent(new Event('change'));})()`);
    assert.equal(await evaluate(`document.getElementById('file').disabled&&document.getElementById('volume').disabled&&document.getElementById('transmit').disabled&&document.getElementById('download').disabled&&document.getElementById('fileSection').inert&&document.getElementById('audioSection').inert`),true);
    await evaluate(`(()=>{const selector=document.getElementById('protocol');selector.value='mt63';selector.dispatchEvent(new Event('change'));})()`);
    await wait('!document.getElementById("download").disabled');
    for(const protocol of ['ax25','mt63','mfsk']){
      await evaluate(`(()=>{const selector=document.getElementById('protocol');selector.value='${protocol}';selector.dispatchEvent(new Event('change'));})()`);
      const before=await evaluate('testDownloads.length');
      await evaluate('document.getElementById("download").click()');
      await wait(`testDownloads.length>${before} && !document.getElementById('download').disabled`);
      const wav=await evaluate(`(async()=>{const download=testDownloads.at(-1),bytes=await (await fetch(download.url)).arrayBuffer(),view=new DataView(bytes),rate=view.getUint32(24,true),channels=view.getUint16(22,true);window.testAudio=await new OfflineAudioContext(1,1,48000).decodeAudioData(bytes);return {rate,channels,name:download.name};})()`);
      assert.equal(wav.rate,protocol==='ax25'?12000:8000);assert.equal(wav.channels,1);assert.equal(wav.name,'apocalipse-'+protocol+'.wav');
      await evaluate('document.getElementById("receiveTab").click();document.getElementById("receive").click()');
      await wait(`document.getElementById('status-${protocol}').textContent==='Listening for packets.' && testReceivers.length>0`);
      assert.equal(await evaluate('document.querySelectorAll(".lane input[role=switch]:checked").length'),3);
      const other=protocol==='ax25'?'mt63':'ax25';
      await evaluate(`document.getElementById('enable-${other}').click()`);
      assert.equal(await evaluate(`(()=>{const lane=document.getElementById('lane-${other}'),active=document.getElementById('lane-${protocol}');return lane.getAttribute('aria-disabled')==='true'&&getComputedStyle(lane.querySelector('.lane-head')).display!=='none'&&lane.querySelector('input[role=switch]').getClientRects().length>0&&[...lane.children].slice(1).every(child=>getComputedStyle(child).display==='none')&&lane.getBoundingClientRect().height<active.getBoundingClientRect().height;})()`),true);
      await evaluate(`document.getElementById('enable-${other}').click()`);
      await wait(`document.getElementById('status-${other}').textContent==='Listening for packets.'`);
      assert.equal(await evaluate(`getComputedStyle(document.getElementById('progress-${other}')).display!=='none'`),true);
      await evaluate(`(()=>{const receiver=testReceivers.at(-1),samples=testAudio.getChannelData(0);for(let at=0;at<samples.length+48000;at+=4096){const block=new Float32Array(4096);block.set(samples.subarray(at,at+4096));receiver.onSamples(block);}})()`);
      await wait(`document.getElementById('status-${protocol}').textContent.includes('complete')`);
      assert.equal(await evaluate(`document.getElementById('downloads-${protocol}').querySelectorAll('button').length`),1);
      const saved=await evaluate(`(async()=>{document.getElementById('downloads-${protocol}').querySelector('button').click();const d=testDownloads.at(-1);return {name:d.name,text:await (await fetch(d.url)).text(),preview:document.getElementById('preview-${protocol}').textContent};})()`);
      assert.equal(saved.name,'enhanced.txt');assert.equal(saved.text,'Radio file test.\n');assert.match(saved.preview,/Radio file test/);
      assert.equal(await evaluate(`document.getElementById('downloads-${other}').children.length`),0);
      await evaluate('document.getElementById("stopReceive").click()');
      assert.equal(await evaluate('testStreams.at(-1).getTracks().every(t=>t.readyState==="ended") && testReceivers.at(-1).node.port.onmessage===null'),true);
      console.log(protocol+' WAV, shared reception, preview, download, and cleanup passed');
    }
    assert.equal(await evaluate(`document.getElementById('receivedList').children.length`),3);
    await evaluate(`document.getElementById('selectAllReceived').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('#receivedList input[type=checkbox]:checked').length===3&&document.getElementById('selectAllReceived').disabled&&!document.getElementById('deselectAllReceived').disabled&&!document.getElementById('downloadSelected').disabled&&!document.getElementById('removeSelected').disabled`),true);
    await evaluate(`document.getElementById('deselectAllReceived').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('#receivedList input[type=checkbox]:checked').length===0&&!document.getElementById('selectAllReceived').disabled&&document.getElementById('deselectAllReceived').disabled&&document.getElementById('downloadSelected').disabled&&document.getElementById('removeSelected').disabled`),true);
    const individual=await evaluate(`(async()=>{document.querySelector('#receivedList li button').click();const saved=testDownloads.at(-1);return {name:saved.name,text:await (await fetch(saved.url)).text()};})()`);
    assert.deepEqual(individual,{name:'enhanced.txt',text:'Radio file test.\n'});
    await evaluate(`(()=>{const boxes=document.querySelectorAll('#receivedList input[type=checkbox]');boxes[0].click();boxes[1].click();})()`);
    const archive=await evaluate(`(async()=>{
      document.getElementById('downloadSelected').click();const saved=testDownloads.at(-1),bytes=new Uint8Array(await (await fetch(saved.url)).arrayBuffer()),view=new DataView(bytes.buffer),decoder=new TextDecoder();
      const entries=[];let at=0;
      while(view.getUint32(at,true)===0x04034b50){
        const size=view.getUint32(at+18,true),nameLength=view.getUint16(at+26,true),extraLength=view.getUint16(at+28,true),start=at+30+nameLength+extraLength;
        entries.push({name:decoder.decode(bytes.subarray(at+30,at+30+nameLength)),text:decoder.decode(bytes.subarray(start,start+size))});at=start+size;
      }
      return {name:saved.name,entries,central:view.getUint32(at,true),end:view.getUint32(bytes.length-22,true),count:view.getUint16(bytes.length-22+10,true)};
    })()`);
    assert.deepEqual(archive,{name:'apocalipse-received-files.zip',entries:[{name:'enhanced.txt',text:'Radio file test.\n'},{name:'enhanced (2).txt',text:'Radio file test.\n'}],central:0x02014b50,end:0x06054b50,count:2});
    await evaluate(`document.querySelectorAll('#receivedList input[type=checkbox]')[1].click()`);
    const single=await evaluate(`(async()=>{document.getElementById('downloadSelected').click();const saved=testDownloads.at(-1);return {name:saved.name,text:await (await fetch(saved.url)).text()};})()`);
    assert.deepEqual(single,{name:'enhanced.txt',text:'Radio file test.\n'});
    await evaluate(`document.querySelectorAll('#receivedList input[type=checkbox]')[1].click();document.getElementById('removeSelected').click()`);
    assert.equal(await evaluate(`document.getElementById('receivedList').children.length===1&&document.getElementById('downloadSelected').disabled&&document.getElementById('removeSelected').disabled`),true);
    await evaluate('document.getElementById("receive").click()');
    await wait('document.getElementById("status-ax25").textContent==="Listening for packets."');
    await evaluate(`(async()=>{
      const frames=ApocalypseCore.makeTransfer(ApocalypseCore.importHtml('<h1>Legacy entry</h1>','index.html'),0xabc123);
      const encoder=await ApocalypseModems.createEncoder('ax25',frames,48000,false),receiver=testReceivers.at(-1);
      const count=Math.ceil(encoder.duration()*48000);
      for(let at=0;at<count+48000;at+=4096){const block=new Float32Array(4096);encoder.fill(block);receiver.onSamples(block);}
      encoder.dispose?.();
    })()`);
    await wait('document.getElementById("preview-ax25").textContent.includes("Legacy APW1 site")');
    assert.equal(await evaluate('document.getElementById("downloads-ax25").children.length'),1);
    assert.equal(await evaluate('document.getElementById("preview-ax25").querySelector("iframe").getAttribute("sandbox")'), '');
    await evaluate(`(async()=>{
      const bytes=new TextEncoder().encode('<h1>Safe HTML</h1><script>window.bad=1</script><img src="https://example.invalid/remote.png"><meta http-equiv="refresh" content="0;url=https://example.invalid/">');
      const frames=ApocalypseCore.makeFileTransfer({name:'unsafe.html',type:'text/html',bytes},0xabc124);
      const encoder=await ApocalypseModems.createEncoder('ax25',frames,48000,false),receiver=testReceivers.at(-1);
      const count=Math.ceil(encoder.duration()*48000);
      for(let at=0;at<count+48000;at+=4096){const block=new Float32Array(4096);encoder.fill(block);receiver.onSamples(block);}
      encoder.dispose?.();
    })()`);
    await wait('document.getElementById("preview-ax25").textContent.includes("unsafe.html")');
    const safety=await evaluate(`(()=>{const frame=document.getElementById('preview-ax25').querySelector('iframe');return {script:frame.srcdoc.includes('<script'),remote:frame.srcdoc.includes('example.invalid'),refresh:frame.srcdoc.includes('http-equiv="refresh"'),sandbox:frame.getAttribute('sandbox'),bad:!!window.bad};})()`);
    assert.deepEqual(safety,{script:false,remote:false,refresh:false,sandbox:'',bad:false});
    assert.equal(await evaluate(`(()=>{const preview=document.getElementById('preview-ax25'),frame=preview.querySelector('iframe');return preview.getBoundingClientRect().height<=280&&frame.getBoundingClientRect().width<=preview.clientWidth&&frame.srcdoc.includes('overflow: auto !important');})()`),true);
    const laneWidth=await evaluate(`document.getElementById('lane-ax25').getBoundingClientRect().width`);
    await evaluate(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=800;canvas.height=800;
      const context=canvas.getContext('2d');context.fillStyle='#228844';context.fillRect(0,0,800,800);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const bytes=new Uint8Array(await blob.arrayBuffer());
      const frames=ApocalypseCore.makeFileTransfer({name:'large.png',type:'image/png',bytes},0xabc125);
      const encoder=await ApocalypseModems.createEncoder('ax25',frames,48000,false),receiver=testReceivers.at(-1);
      const count=Math.ceil(encoder.duration()*48000);
      for(let at=0;at<count+48000;at+=4096){const block=new Float32Array(4096);encoder.fill(block);receiver.onSamples(block);}
      encoder.dispose?.();
    })()`);
    await wait(`document.querySelector('#preview-ax25 img')?.naturalWidth===800`);
    const imageLayout=await evaluate(`(()=>{const lane=document.getElementById('lane-ax25'),preview=document.getElementById('preview-ax25');return {laneWidth:lane.getBoundingClientRect().width,height:preview.getBoundingClientRect().height,horizontal:preview.scrollWidth>preview.clientWidth,vertical:preview.scrollHeight>preview.clientHeight};})()`);
    assert.ok(Math.abs(imageLayout.laneWidth-laneWidth)<1,imageLayout.laneWidth+' vs '+laneWidth);
    assert.ok(imageLayout.height<=280&&imageLayout.horizontal&&imageLayout.vertical,JSON.stringify(imageLayout));
    assert.equal(await evaluate(`document.getElementById('receivedList').children.length`),4);
    await evaluate('document.getElementById("stopReceive").click()');
    console.log('Received file list, ZIP export, removal, legacy reception, and bounded previews passed');
  }finally{ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

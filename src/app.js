(function(){'use strict';
  const c=ApocalypseCore,$=id=>document.getElementById(id),file=$('file'),sourceStatus=$('sourceStatus'),txStatus=$('txStatus'),rxStatus=$('rxStatus');
  let source=null,received=null,frames=null,tx=null,rx=null,previewUrls=[];
  function selectView(view){
    for(const name of ['transmit','receive']){
      const active=name===view,tab=$(name+'Tab');
      tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
      $(name+'Panel').hidden=!active;
    }
    if(view==='receive'&&$('consoleFollow').checked)$('consoleLog').scrollTop=$('consoleLog').scrollHeight;
  }
  for(const name of ['transmit','receive']){
    const tab=$(name+'Tab');
    tab.addEventListener('click',()=>selectView(name));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?'transmit':event.key==='End'?'receive':name==='transmit'?'receive':'transmit';
      selectView(next);$(next+'Tab').focus();
    });
  }
  const waveCanvas=$('waveform'),waveCtx=waveCanvas.getContext('2d');let waveFrame=0;
  function drawWave(samples){const w=waveCanvas.width,h=waveCanvas.height,mid=h/2;waveCtx.fillStyle='#0d1b1b';waveCtx.fillRect(0,0,w,h);waveCtx.strokeStyle='#294846';waveCtx.lineWidth=1;waveCtx.beginPath();waveCtx.moveTo(0,mid+.5);waveCtx.lineTo(w,mid+.5);waveCtx.stroke();if(!samples){waveCtx.fillStyle='#8eaaa2';waveCtx.font='13px system-ui';waveCtx.fillText('Microphone off',12,21);return;}let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample));const scale=Math.min(8,.85/Math.max(peak,.01));waveCtx.strokeStyle='#8fe4bd';waveCtx.lineWidth=1;waveCtx.beginPath();for(let x=0;x<w;x++){let low=1,high=-1;const start=Math.floor(x*samples.length/w),end=Math.max(start+1,Math.floor((x+1)*samples.length/w));for(let i=start;i<end;i++){const v=samples[i]*scale;if(v<low)low=v;if(v>high)high=v;}waveCtx.moveTo(x+.5,mid-high*(h*.42));waveCtx.lineTo(x+.5,mid-low*(h*.42));}waveCtx.stroke();}
  drawWave(null);
  const consoleLog=$('consoleLog'),consoleFollow=$('consoleFollow');
  let logQueue=[],logHistory=[],logTimer=0,logStartedAt=new Date();
  function flushLogs(){
    logTimer=0;const fragment=document.createDocumentFragment();
    for(const entry of logQueue){
      const row=document.createElement('div');row.className='console-entry log-'+entry.level.toLowerCase();
      const time=document.createElement('time');time.className='console-time';time.dateTime=entry.time.toISOString();time.textContent=entry.time.toLocaleTimeString(undefined,{hour12:false})+'.'+String(entry.time.getMilliseconds()).padStart(3,'0')+' ';
      const tag=document.createElement('span');tag.className='console-tag';tag.textContent='['+entry.level+'] ['+entry.scope+'] ';
      row.append(time,tag,document.createTextNode(entry.message));fragment.append(row);
    }
    logQueue=[];consoleLog.append(fragment);
    while(consoleLog.children.length>500)consoleLog.firstElementChild.remove();
    if(consoleFollow.checked)consoleLog.scrollTop=consoleLog.scrollHeight;
  }
  function log(level,message,scope='APP'){
    const entry={level,message:String(message),scope,time:new Date()};
    logHistory.push(entry);logQueue.push(entry);
    if(logQueue.length>500)logQueue.shift();
    if(!logTimer)logTimer=setTimeout(flushLogs,100);
  }
  $('clearConsole').addEventListener('click',()=>{clearTimeout(logTimer);logTimer=0;logQueue=[];logHistory=[];logStartedAt=new Date();if(rx)rx.rawText='';consoleLog.replaceChildren();});
  $('downloadConsole').addEventListener('click',()=>{
    // Include text still waiting to be displayed, not just the 500 visible rows.
    if(rx)flushReceivedText(rx);
    const now=new Date(),id=$('protocol').value;
    const header=[
      'Apocalipse Web diagnostic log · format 1',
      'Started: '+logStartedAt.toISOString(),
      'Exported: '+now.toISOString(),
      'Local time zone: '+Intl.DateTimeFormat().resolvedOptions().timeZone,
      'Entry timestamps: UTC (ISO 8601)',
      'Selected protocol: '+$('protocol').selectedOptions[0].textContent,
      'Browser: '+navigator.userAgent,
      'Receive status: '+rxStatus.textContent,
      'Receive diagnostics: '+$('rxDetail').textContent,
      'Entries: '+logHistory.length,
      'RAW = unverified decoder output, including possible noise. Only checksum-validated page packets advance progress.',
      ''
    ].join('\n');
    const parts=[header+'\n',...logHistory.map(entry=>`${entry.time.toISOString()} [${entry.level}] [${entry.scope}] ${entry.message}\n`)];
    const url=URL.createObjectURL(new Blob(parts,{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
    a.href=url;a.download='apocalipse-console-'+id+'-'+now.toISOString().replace(/[:.]/g,'-')+'.txt';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  consoleFollow.addEventListener('change',()=>{if(consoleFollow.checked)consoleLog.scrollTop=consoleLog.scrollHeight;});
  window.addEventListener('error',event=>log('ERROR',event.message||'A page resource failed to load.','APP'));
  window.addEventListener('unhandledrejection',event=>log('ERROR',event.reason?.message||String(event.reason),'APP'));
  function status(el,msg,level='INFO'){if(el.textContent!==msg)log(level,msg,el===rxStatus?'RX':el===txStatus?'TX':'FILE');el.textContent=msg;}
  function packetData(frame){return Array.from(frame,b=>b.toString(16).padStart(2,'0')).join(' ')+' | '+JSON.stringify(new TextDecoder().decode(frame));}
  function flushReceivedText(session){if(session.rawText){log('RAW','Unverified decoder text: '+JSON.stringify(session.rawText),'MT63');session.rawText='';}}
  function seconds(s){const total=Math.ceil(s);return total<60?`${total} seconds`:`${Math.floor(total/60)} min ${String(total%60).padStart(2,'0')} sec`;}
  const modems=ApocalypseModems,selector=$('protocol');
  let sourceBytes=0,sourceName='',fileVersion=0,waveJob=null;
  function selected(){return modems.protocol(selector.value);}
  function updateSource(){
    const ready=!!source&&!!frames;
    $('transmit').disabled=!ready||!!tx;
    $('download').disabled=!ready||!!waveJob;
    $('previewSource').disabled=!ready;
  }
  function describeSource(){
    if(!source)return;
    const sec=modems.duration(selector.value,frames);
    status(sourceStatus,`${sourceName}: ${source.files.length} file(s), ${sourceBytes.toLocaleString()} input bytes · ${frames.length} packets · ${selected().label} · about ${seconds(sec)} per pass.`);
  }
  function prepareSource(){
    frames=source?c.makeTransfer(source,crypto.getRandomValues(new Uint32Array(1))[0]):null;
    describeSource();updateSource();
  }
  function resetReception(){
    received=null;$('openReceived').hidden=true;$('progress').max=1;$('progress').value=0;
    $('rxDetail').textContent='';
    $('preview').srcdoc='';$('previewLabel').textContent='No page to show.';
  }
  function refreshProtocol(){
    $('protocolDetail').textContent=selected().label+' · '+selected().detail;
    log('INFO','Selected '+selected().label+'. '+selected().help,'PROTOCOL');
    status(txStatus,source?'Ready to transmit '+selected().label+'.':'Waiting for a page · '+selected().label+'.');
    status(rxStatus,'Ready to receive '+selected().label+'. Select the same protocol as the transmitter.');
  }
  selector.addEventListener('change',()=>{
    stopTx();stopRx();waveJob=null;resetReception();
    try{prepareSource();}catch(e){frames=null;updateSource();status(sourceStatus,e.message,'ERROR');}
    refreshProtocol();
  });
  file.addEventListener('change',async()=>{
    const version=++fileVersion;stopTx();waveJob=null;source=null;frames=null;updateSource();
    const f=file.files[0];if(!f){status(sourceStatus,'No page selected.');return;}
    try{
      status(sourceStatus,'Reading '+f.name+'…');
      const bytes=new Uint8Array(await f.arrayBuffer());
      const imported=/\.zip$/i.test(f.name)?await c.importZip(bytes):c.importHtml(bytes,f.name);
      if(version!==fileVersion)return;
      source=imported;sourceName=f.name;sourceBytes=bytes.length;prepareSource();
      status(txStatus,'Ready to transmit '+selected().label+'.');
    }catch(e){if(version===fileVersion){source=null;frames=null;updateSource();status(sourceStatus,e.message,'ERROR');}}
  });
  $('volume').addEventListener('input',()=>{$('volumeValue').textContent=$('volume').value+'%';if(tx?.gain)tx.gain.gain.value=Number($('volume').value)/100;});
  function stopTx(){
    if(!tx)return;const session=tx;tx=null;
    if(session.node){session.node.onaudioprocess=null;session.node.disconnect();}
    session.gain?.disconnect();session.encoder?.dispose?.();session.context?.close().catch(()=>{});
    $('stopTransmit').disabled=true;updateSource();status(txStatus,'Stopped.');
  }
  $('transmit').addEventListener('click',async()=>{
    if(!frames||tx)return;
    const id=selector.value,session={};tx=session;updateSource();$('stopTransmit').disabled=false;
    try{
      status(txStatus,'Preparing '+selected().label+' audio…');
      const context=session.context=new (window.AudioContext||window.webkitAudioContext)();
      await context.resume();if(tx!==session)return;
      const encoder=await modems.createEncoder(id,frames,context.sampleRate,true);
      if(tx!==session){encoder.dispose?.();return;}
      session.encoder=encoder;
      const gain=session.gain=context.createGain(),node=session.node=context.createScriptProcessor(4096,0,1);
      gain.gain.value=Number($('volume').value)/100;let sentSamples=0,lastCycle=0;
      node.onaudioprocess=e=>{
        try{const output=e.outputBuffer.getChannelData(0);encoder.fill(output);sentSamples+=output.length;const cycle=1+Math.floor(sentSamples/context.sampleRate/encoder.duration());if(cycle!==lastCycle){lastCycle=cycle;status(txStatus,`${modems.protocol(id).label} · repeating · cycle ${cycle}`);}}
        catch(error){stopTx();status(txStatus,error.message,'ERROR');}
      };
      node.connect(gain).connect(context.destination);
      status(txStatus,`Transmitting ${frames.length} packets using ${modems.protocol(id).label}.`);
    }catch(e){if(tx===session){stopTx();status(txStatus,e.message,'ERROR');}}
  });
  $('stopTransmit').addEventListener('click',stopTx);
  $('download').addEventListener('click',async()=>{
    if(!frames||waveJob)return;
    const id=selector.value,packets=frames,rate=modems.protocol(id).waveRate,sec=modems.duration(id,packets);
    if(sec>600){status(txStatus,'WAV exceeds 10 minutes with '+modems.protocol(id).label+'. Use live repeating transmission.','WARNING');return;}
    const job={};waveJob=job;updateSource();let encoder;
    try{
      status(txStatus,'Building '+modems.protocol(id).label+' WAV…');
      encoder=await modems.createEncoder(id,packets,rate,false);if(waveJob!==job)return;
      const samples=Math.ceil(sec*rate),wav=new ArrayBuffer(44+samples*2),view=new DataView(wav);
      function str(pos,s){for(let i=0;i<s.length;i++)view.setUint8(pos+i,s.charCodeAt(i));}
      str(0,'RIFF');view.setUint32(4,36+samples*2,true);str(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples*2,true);
      const block=new Float32Array(4096),volume=Number($('volume').value)/100;
      for(let at=0;at<samples;){
        encoder.fill(block);for(let i=0;i<block.length&&at<samples;i++,at++)view.setInt16(44+at*2,Math.round(Math.max(-1,Math.min(1,block[i]*volume))*32767),true);
        if(at%(4096*16)===0){await new Promise(resolve=>setTimeout(resolve,0));if(waveJob!==job)return;}
      }
      if(waveJob!==job)return;
      const url=URL.createObjectURL(new Blob([wav],{type:'audio/wav'})),a=document.createElement('a');a.href=url;a.download='apocalipse-web-'+id+'.wav';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status(txStatus,`Downloaded ${modems.protocol(id).label} · one ${seconds(sec)} pass.`);
    }catch(e){if(waveJob===job)status(txStatus,e.message,'ERROR');}
    finally{encoder?.dispose?.();if(waveJob===job){waveJob=null;updateSource();}}
  });
  function stopRx(){
    if(!rx)return;const session=rx;rx=null;
    flushReceivedText(session);
    ApocalypseCapture.dispose(session.node);
    session.stream?.getTracks().forEach(t=>t.stop());session.source?.disconnect();session.sink?.disconnect();session.demod?.dispose?.();session.context?.close().catch(()=>{});
    if(waveFrame){cancelAnimationFrame(waveFrame);waveFrame=0;}drawWave(null);
    $('receive').disabled=false;$('stopReceive').disabled=true;$('level').style.width='0';
    const p=session.receiver?.progress();status(rxStatus,received?'Microphone stopped. Received page validated.':p?.total?`Microphone stopped · ${p.received}/${p.total} packets received.`:'Microphone stopped.');
  }
  $('receive').addEventListener('click',async()=>{
    if(rx)return;
    const id=selector.value,session={samples:0,lastDetail:0,lastNewPacket:0,lastCount:0,validPackets:0,rawText:'',lastLog:0};rx=session;resetReception();$('receive').disabled=true;$('stopReceive').disabled=false;
    try{
      status(rxStatus,'Starting '+modems.protocol(id).label+' receiver…');
      if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser does not allow microphone access from this file. Try a current Chrome, Edge or Firefox, or check microphone permissions.');
      // Resume on the click gesture, before waiting on microphone permission or WASM.
      const context=session.context=new (window.AudioContext||window.webkitAudioContext)();await context.resume();if(rx!==session)return;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if(rx!==session){stream.getTracks().forEach(t=>t.stop());return;}session.stream=stream;
      log('INFO',`Input: ${stream.getAudioTracks()[0]?.label||'microphone'} · ${context.sampleRate} Hz · ${modems.protocol(id).label}`,'AUDIO');
      const settings=stream.getAudioTracks()[0]?.getSettings?.()||{};
      log('INFO','Capture settings: '+JSON.stringify({sampleRate:settings.sampleRate,channelCount:settings.channelCount,echoCancellation:settings.echoCancellation,noiseSuppression:settings.noiseSuppression,autoGainControl:settings.autoGainControl}),'AUDIO');
      if(id==='mt63')log('INFO','RAW output may contain noise even with no transmission. Only checksum-validated page packets advance progress.','MT63');
      const receiver=session.receiver=new c.TransferReceiver();
      const demod=await modems.createDecoder(id,context.sampleRate,frame=>{
        if(rx!==session)return;
        flushReceivedText(session);
        log('DATA',`${modems.protocol(id).label} · ${frame.length} FCS-validated frame bytes: `+packetData(frame),'RX');
        const before=receiver.progress(),previousSite=receiver.site,previousSession=receiver.active;
        if(!receiver.acceptFrame(frame)){log('WARNING','Frame rejected: invalid or unsupported page packet.','RX');return;}
        const p=receiver.progress();$('progress').max=p.total;$('progress').value=p.received;
        const payload=c.parseFrame(frame),number=(payload[10]|payload[11]<<8)+1;
        const isNew=previousSession!==receiver.active||p.received!==before.received;
        log('INFO',`Packet ${number}/${p.total} · session ${receiver.active.toString(16).padStart(8,'0')} · ${isNew?'new packet':'repeat'} · ${p.received}/${p.total} collected`,'RX');
        session.validPackets++;if(isNew){session.lastCount=p.received;session.lastNewPacket=session.samples/context.sampleRate;}
        status(rxStatus,p.complete?`${modems.protocol(id).label} · complete: ${receiver.site.files.length} files received.`:`${modems.protocol(id).label} · receiving ${p.received}/${p.total} packets. Keep listening for repeats.`);
        if(receiver.site){received=receiver.site;if(receiver.site!==previousSite){openReceived();log('SUCCESS','Validated page received: '+receiver.site.files.map(f=>`${f.path} (${f.bytes.length} bytes)`).join(', '),'RX');}}
        else if(p.received===p.total)log('ERROR','All packets arrived, but site reconstruction or file checksum validation failed.','RX');
      },event=>{
        if(rx!==session)return;
        if(event.text!==undefined){session.rawText+=event.text;if(session.rawText.includes('\n')||session.rawText.length>=256)flushReceivedText(session);}
        else{flushReceivedText(session);log(event.level,event.message+(event.bytes?' '+packetData(event.bytes):''),modems.protocol(id).label);}
      });
      if(rx!==session){demod.dispose?.();return;}session.demod=demod;
      const source=session.source=context.createMediaStreamSource(stream);
      const node=await ApocalypseCapture.create(context,samples=>{
        if(rx!==session)return;
        try{session.samples+=samples.length;demod.feed(samples);$('level').style.width=Math.min(100,demod.level*350)+'%';
          const elapsed=session.samples/context.sampleRate;
          if(elapsed-session.lastDetail>=1)flushReceivedText(session);
          if(id==='mt63'&&elapsed-session.lastDetail>=1){session.lastDetail=elapsed;const d=demod.diagnostics(),p=receiver.progress(),age=Math.floor(elapsed-session.lastNewPacket);$('rxDetail').textContent=`Decoder output: ${d.characters} unverified characters · ${d.rejected} rejected records · ${session.validPackets} valid packets (including repeats). `+(p.complete?'Page complete.':p.received?`Last new packet ${age}s ago.`:'Waiting for the first complete packet.');}
          if(elapsed-session.lastLog>=10){session.lastLog=elapsed;const p=receiver.progress();
            if(demod.level<.0005)log('WARNING','Input is nearly silent. Check the microphone and radio volume.','AUDIO');
            else if(samples.some(x=>Math.abs(x)>=.99))log('WARNING','Input is near clipping. Reduce the audio level.','AUDIO');
            if(!p.complete){log('INFO',id==='mt63'?$('rxDetail').textContent:`Listening ${Math.floor(elapsed)}s · ${p.received}/${p.total||'?'} packets collected · input ${Math.round(20*Math.log10(Math.max(demod.level,1e-9)))} dBFS`,'RX');if(p.received&&elapsed-session.lastNewPacket>(id==='mfsk'?120:40))log('WARNING',`No new packet for ${Math.floor(elapsed-session.lastNewPacket)}s; ${p.received}/${p.total} collected.`,'RX');}
          }
          if(!waveFrame){const snapshot=samples.slice();waveFrame=requestAnimationFrame(()=>{waveFrame=0;drawWave(snapshot);});}}
        catch(error){stopRx();status(rxStatus,error.message,'ERROR');}
      },(level,message)=>{if(rx===session)log(level,message,'AUDIO');});
      if(rx!==session){ApocalypseCapture.dispose(node);return;}session.node=node;
      source.connect(node);
      // The worklet is a capture-only automatic-pull node. Only the legacy
      // ScriptProcessor fallback requires an output connection to stay active.
      if(node.numberOfOutputs){const sink=session.sink=context.createGain();sink.gain.value=0;node.connect(sink).connect(context.destination);}
      status(rxStatus,'Listening for '+modems.protocol(id).label+' packets…');
    }catch(e){if(rx===session){stopRx();status(rxStatus,e.message,'ERROR');}}
  });
  $('stopReceive').addEventListener('click',stopRx);
  refreshProtocol();updateSource();

  function mime(path){const ext=path.split('.').pop().toLowerCase();return {html:'text/html',htm:'text/html',css:'text/css',js:'text/javascript',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',webp:'image/webp',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',mp3:'audio/mpeg',wav:'audio/wav',mp4:'video/mp4'}[ext]||'application/octet-stream';}
  function preview(site,page=site.entry,view=null){const pageUrls=view?view.urls:previewUrls;for(const u of pageUrls)URL.revokeObjectURL(u);pageUrls.length=0;const files=new Map(site.files.map(f=>[f.path,f]));if(!files.has(page))return;const urls=new Map();function asset(path,stack=[]){if(urls.has(path))return urls.get(path);if(stack.includes(path)||!files.has(path))return null;let b=files.get(path).bytes;if(/\.css$/i.test(path)){let css=new TextDecoder().decode(b);css=css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi,(all,q,ref)=>{if(/^data:/i.test(ref.trim()))return all;const p=c.resolvePath(path,ref.trim()),u=p?asset(p,[...stack,path]):null;return u?`url("${u}")`:'url("")';});css=css.replace(/@import\s+(?:url\()?\s*["']([^"']+\.css)["']\s*\)?/gi,(all,ref)=>{const p=c.resolvePath(path,ref),u=p?asset(p,[...stack,path]):null;return u?`@import url("${u}")`:'@import url("")';});b=new TextEncoder().encode(css);}const u=URL.createObjectURL(new Blob([b],{type:mime(path)}));urls.set(path,u);pageUrls.push(u);return u;}
    const doc=new DOMParser().parseFromString(new TextDecoder().decode(files.get(page).bytes),'text/html');for(const el of doc.querySelectorAll('[src],[href],[poster],[srcset]')){for(const attr of ['src','href','poster'])if(el.hasAttribute(attr)){const value=el.getAttribute(attr),p=c.resolvePath(page,value);if(attr==='href'&&p&&/\.html?$/i.test(p)&&files.has(p)){el.setAttribute('href','#');el.dataset.localPage=p;}else if(p&&files.has(p))el.setAttribute(attr,asset(p));else if(!value.startsWith('#')&&!/^data:/i.test(value))el.removeAttribute(attr);}if(el.hasAttribute('srcset')){const value=el.getAttribute('srcset');const entries=value.split(',').map(item=>{const [ref,...rest]=item.trim().split(/\s+/),p=c.resolvePath(page,ref),u=p?asset(p):null;return u?u+' '+rest.join(' '):null;}).filter(Boolean);if(entries.length)el.setAttribute('srcset',entries.join(', '));else el.removeAttribute('srcset');}}for(const el of doc.querySelectorAll('style,[style]')){const css=el.tagName==='STYLE'?el.textContent:el.getAttribute('style');const changed=css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi,(all,q,ref)=>{if(/^data:/i.test(ref.trim()))return all;const p=c.resolvePath(page,ref.trim()),u=p?asset(p):null;return u?`url("${u}")`:'url("")';});if(el.tagName==='STYLE')el.textContent=changed;else el.setAttribute('style',changed);}const meta=doc.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; media-src blob: data:;";doc.head.prepend(meta);for(const el of doc.querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv="refresh"]'))el.remove();const frame=view?view.frame:$('preview');frame.srcdoc='<!doctype html>'+doc.documentElement.outerHTML;frame.onload=()=>{frame.contentDocument?.addEventListener('click',e=>{const a=e.target.closest?.('a');if(!a)return;if(a.dataset.localPage){e.preventDefault();preview(site,a.dataset.localPage,view);}else if(!a.getAttribute('href')?.startsWith('#'))e.preventDefault();});};if(view){view.tab.document.title=page;}else{selectView('receive');$('previewLabel').textContent=page;frame.closest('section').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}}
  function openReceived(){
    if(!received)return;
    const tab=window.open('','_blank');
    if(!tab){
      $('openReceived').hidden=false;
      log('WARNING','Page received, but the browser blocked the new tab. Use Open received page, or allow pop-ups for automatic opening.','RX');
      return;
    }
    tab.opener=null;
    const doc=tab.document,frame=doc.createElement('iframe');
    frame.title='Received page';frame.setAttribute('sandbox','allow-same-origin');
    frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;background:white';
    doc.body.replaceChildren(frame);
    preview(received,received.entry,{tab,frame,urls:[]});
    $('openReceived').hidden=true;
    log('INFO','Received page opened in a new tab.','RX');
  }
  $('openReceived').addEventListener('click',openReceived);
  $('previewSource').addEventListener('click',()=>{if(source)preview(source);});
})();

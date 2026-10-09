(function(){'use strict';
  const c=ApocalypseCore,m=ApocalypseModems,$=id=>document.getElementById(id);
  const standaloneHtml='<!doctype html>\n'+document.documentElement.outerHTML;
  const ids=['mt63','ax25','mfsk'],lanes=Object.fromEntries(ids.map(id=>[id,{id,receiver:new c.EnhancedTransferReceiver(),urls:[],generation:0,decoder:null,raw:''}]));
  let file=null,sourceKind=null,frames=null,tx=null,rx=null,waveJob=null,fileVersion=0,waveFrame=0;
  const selector=$('protocol'),canvas=$('waveform'),ctx=canvas.getContext('2d');
  function log(level,message,scope='APP'){
    const row=document.createElement('div');row.className=level.toLowerCase();
    row.textContent=`${new Date().toLocaleTimeString()} [${level}] [${scope}] ${message}`;
    $('consoleLog').append(row);while($('consoleLog').children.length>500)$('consoleLog').firstChild.remove();
    if($('consoleFollow').checked)$('consoleLog').scrollTop=$('consoleLog').scrollHeight;
  }
  $('clearConsole').onclick=()=>$('consoleLog').replaceChildren();
  function seconds(n){n=Math.ceil(n);return n<60?`${n}s`:`${Math.floor(n/60)}m ${String(n%60).padStart(2,'0')}s`;}
  function selectTab(name){for(const v of ['transmit','receive']){const active=v===name,tab=$(v+'Tab');tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(v+'Panel').hidden=!active;}}
  for(const name of ['transmit','receive']){
    $(name+'Tab').onclick=()=>selectTab(name);
    $(name+'Tab').onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?'transmit':e.key==='End'?'receive':name==='transmit'?'receive':'transmit';selectTab(next);$(next+'Tab').focus();};
  }
  function txControls(){const ready=!!selector.value&&!!frames;$('transmit').disabled=!ready||!!tx;$('download').disabled=!ready||!!waveJob;$('stopTransmit').disabled=!tx;}
  function prepare(){frames=selector.value&&file?c.makeFileTransfer(file,crypto.getRandomValues(new Uint32Array(1))[0]):null;txControls();if(frames){const size=c.packFile(file).length;$(sourceKind==='text'?'textStatus':'sourceStatus').textContent=`${file.name} · ${file.bytes.length.toLocaleString()} bytes · ${size.toLocaleString()} packed bytes · ${frames.length} packets · ${m.protocol(selector.value).label} · about ${seconds(m.duration(selector.value,frames))} per pass.`;}}
  function stopTx(){if(!tx)return;const s=tx;tx=null;if(s.node){s.node.onaudioprocess=null;s.node.disconnect();}s.gain?.disconnect();s.encoder?.dispose?.();s.context?.close().catch(()=>{});txControls();$('txStatus').textContent='Stopped.';}
  selector.onchange=()=>{
    stopTx();waveJob=null;const chosen=!!selector.value;
    for(const id of ['fileSection','textSection','audioSection']){const section=$(id);section.inert=!chosen;section.classList.toggle('tx-disabled',!chosen);section.setAttribute('aria-disabled',String(!chosen));}
    $('file').disabled=!chosen;$('plainText').disabled=!chosen;$('generateText').disabled=!chosen||!$('plainText').value.length;$('volume').disabled=!chosen;
    if(!chosen){frames=null;txControls();$('protocolDetail').textContent='';$('sourceStatus').textContent=sourceKind==='file'&&file?`${file.name} selected. Choose a protocol to continue.`:'Select a protocol first.';$('textStatus').textContent=sourceKind==='text'&&file?'Generated text selected. Choose a protocol to continue.':'';$('txStatus').textContent='Select a protocol first.';return;}
    try{prepare();$('protocolDetail').textContent=m.protocol(selector.value).detail;if(sourceKind!=='file')$('sourceStatus').textContent='No file selected.';if(!file)$('textStatus').textContent='';$('txStatus').textContent=file?'':'Waiting for a file or text.';}
    catch(e){frames=null;txControls();$(sourceKind==='text'?'textStatus':'sourceStatus').textContent=e.message;}
  };
  selector.onchange();
  $('file').onchange=async()=>{
    const version=++fileVersion;stopTx();waveJob=null;file=null;sourceKind='file';frames=null;$('textStatus').textContent='';txControls();const selected=$('file').files[0];
    if(!selected){$('sourceStatus').textContent='No file selected.';$('txStatus').textContent='Waiting for a file or text.';return;}
    try{$('sourceStatus').textContent='Reading '+selected.name+'…';const bytes=new Uint8Array(await selected.arrayBuffer());if(version!==fileVersion)return;file={name:selected.name,type:selected.type||'',bytes};prepare();if(!selector.value)$('sourceStatus').textContent=`${file.name} selected. Choose a protocol to continue.`;$('txStatus').textContent=selector.value?'':'Select a protocol first.';}
    catch(e){if(version===fileVersion){file=null;frames=null;txControls();$('sourceStatus').textContent=e.message;log('ERROR',e.message,'TX');}}
  };
  $('plainText').oninput=()=>{
    $('generateText').disabled=!selector.value||!$('plainText').value.length;
    if(sourceKind!=='text')return;
    ++fileVersion;stopTx();waveJob=null;file=null;frames=null;txControls();
    $('textStatus').textContent=$('plainText').value?'Text changed. Generate again.':'';
    $('txStatus').textContent='Waiting for a file or text.';
  };
  $('generateText').onclick=()=>{
    if(!selector.value||!$('plainText').value.length)return;
    ++fileVersion;stopTx();waveJob=null;sourceKind='text';frames=null;
    $('file').value='';$('sourceStatus').textContent='No file selected.';
    file={name:'message.txt',type:'text/plain',bytes:new TextEncoder().encode($('plainText').value)};
    try{prepare();$('txStatus').textContent='';}
    catch(e){frames=null;txControls();$('textStatus').textContent=e.message;log('ERROR',e.message,'TX');}
  };
  $('volume').oninput=()=>{$('volumeValue').textContent=$('volume').value+'%';if(tx?.gain)tx.gain.gain.value=Number($('volume').value)/100;};
  $('transmit').onclick=async()=>{
    if(!frames||tx)return;const s=tx={},id=selector.value,packets=frames;txControls();
    try{
      $('txStatus').textContent='Preparing audio…';const context=s.context=new (window.AudioContext||window.webkitAudioContext)();await context.resume();if(tx!==s)return;
      const encoder=await m.createEncoder(id,packets,context.sampleRate,true);if(tx!==s){encoder.dispose?.();return;}s.encoder=encoder;
      const gain=s.gain=context.createGain(),node=s.node=context.createScriptProcessor(4096,0,1);gain.gain.value=Number($('volume').value)/100;
      node.onaudioprocess=e=>{try{encoder.fill(e.outputBuffer.getChannelData(0));}catch(error){stopTx();$('txStatus').textContent=error.message;log('ERROR',error.message,'TX');}};
      node.connect(gain).connect(context.destination);$('txStatus').textContent=`Repeating ${packets.length} packets on ${m.protocol(id).label}.`;
    }catch(e){if(tx===s){stopTx();$('txStatus').textContent=e.message;log('ERROR',e.message,'TX');}}
  };
  $('stopTransmit').onclick=stopTx;
  $('download').onclick=async()=>{
    if(!frames||waveJob)return;const id=selector.value,packets=frames,rate=m.protocol(id).waveRate,duration=m.duration(id,packets);
    if(duration>600){$('txStatus').textContent='WAV exceeds ten minutes. Use live repeating audio.';return;}
    const job=waveJob={};txControls();let encoder;
    try{
      $('txStatus').textContent='Building WAV…';encoder=await m.createEncoder(id,packets,rate,false);if(waveJob!==job)return;
      const count=Math.ceil(duration*rate),wav=new ArrayBuffer(44+count*2),view=new DataView(wav);
      function ascii(at,s){for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));}
      ascii(0,'RIFF');view.setUint32(4,36+count*2,true);ascii(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,count*2,true);
      const block=new Float32Array(4096),volume=Number($('volume').value)/100;
      for(let at=0;at<count;){encoder.fill(block);for(let i=0;i<block.length&&at<count;i++,at++)view.setInt16(44+at*2,Math.round(Math.max(-1,Math.min(1,block[i]*volume))*32767),true);if(at%(4096*16)===0){await new Promise(resolve=>setTimeout(resolve,0));if(waveJob!==job)return;}}
      if(waveJob!==job)return;const url=URL.createObjectURL(new Blob([wav],{type:'audio/wav'})),a=document.createElement('a');a.href=url;a.download='apocalipse-'+id+'.wav';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);$('txStatus').textContent=`Downloaded one ${seconds(duration)} pass.`;
    }catch(e){if(waveJob===job){$('txStatus').textContent=e.message;log('ERROR',e.message,'TX');}}
    finally{encoder?.dispose?.();if(waveJob===job){waveJob=null;txControls();}}
  };
  function draw(samples){const w=canvas.width,h=canvas.height;ctx.fillStyle='#071008';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#82df90';ctx.beginPath();if(samples){let peak=.01;for(const x of samples)peak=Math.max(peak,Math.abs(x));for(let i=0;i<w;i++){const x=samples[Math.floor(i*samples.length/w)]/peak;ctx.lineTo(i,h/2-x*h*.42);}}else{ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);}ctx.stroke();}
  draw(null);
  let focusedReceiver='mt63';
  function renderReceiverDetail(){
    const lane=lanes[focusedReceiver];$('receiverDetailTitle').textContent=m.protocol(lane.id).label+' details';$('receiverDetailStatus').textContent=$('status-'+lane.id).textContent;
    for(const id of ids){const selected=id===focusedReceiver,preview=$('preview-'+id),downloads=$('downloads-'+id);
      $('lane-'+id).setAttribute('aria-current',String(selected));$('focus-'+id).setAttribute('aria-pressed',String(selected));
      preview.hidden=!selected||!preview.childNodes.length;downloads.hidden=!selected||!downloads.childNodes.length;
    }
  }
  function setLaneStatus(lane,message){$('status-'+lane.id).textContent=message;if(lane.id===focusedReceiver)$('receiverDetailStatus').textContent=message;}
  for(const lane of Object.values(lanes))$('focus-'+lane.id).onclick=()=>{focusedReceiver=lane.id;renderReceiverDetail();};
  renderReceiverDetail();
  function clearPreview(lane){for(const url of lane.urls)URL.revokeObjectURL(url);lane.urls=[];$('preview-'+lane.id).replaceChildren();$('downloads-'+lane.id).replaceChildren();}
  function objectUrl(lane,data,type){const url=URL.createObjectURL(new Blob([data],{type}));lane.urls.push(url);return url;}
  function downloadButton(lane,name,data,type,site=null){
    const row=document.createElement('div');row.className='download-item';
    const label=document.createElement('span');label.className='download-name';label.textContent=name;
    const actions=document.createElement('span');actions.className='download-actions';
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Download';button.setAttribute('aria-label','Download '+name);
    const url=objectUrl(lane,data,type||'application/octet-stream');button.onclick=()=>{const a=document.createElement('a');a.href=url;a.download=name;a.click();};
    actions.append(button);row.append(label,actions);$('downloads-'+lane.id).append(row);
    const addOpen=found=>{if(!found||!row.isConnected)return;const open=document.createElement('button');open.type='button';open.className='secondary';open.textContent='Open site';open.setAttribute('aria-label','Open site '+name);open.onclick=()=>openSite({name,site:found});actions.prepend(open);};
    const found=websiteSite(name,mime(name,type||''),data,site);
    if(found instanceof Promise)found.then(addOpen);else addOpen(found);
  }
  const mimeByExt={html:'text/html',htm:'text/html',txt:'text/plain',css:'text/css',js:'text/javascript',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm',svg:'image/svg+xml',woff:'font/woff',woff2:'font/woff2'};
  function mime(name,type=''){const t=type.split(';')[0].toLowerCase();return t||mimeByExt[name.split('.').pop().toLowerCase()]||'application/octet-stream';}
  function utf8(data){try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{return null;}}
  function websiteSite(name,type,bytes,site=null){
    if((type==='text/html'||/\.html?$/i.test(name))&&utf8(bytes)!==null)return site||{entry:name,files:[{path:name,bytes}]};
    if(type==='application/zip'||type==='application/x-zip-compressed'||/\.zip$/i.test(name))return c.importZip(bytes).then(found=>utf8(found.files.find(entry=>entry.path===found.entry)?.bytes||new Uint8Array())!==null?found:null).catch(()=>null);
    return null;
  }
  function dataUrl(data,type){let binary='';for(const byte of data)binary+=String.fromCharCode(byte);return `data:${type};base64,${btoa(binary)}`;}
  let receivedFiles=[],nextReceivedId=0;
  const selectedReceived=new Set();
  function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  $('downloadApp').onclick=()=>saveBlob(new Blob([standaloneHtml],{type:'text/html;charset=utf-8'}),'index.html');
  function saveReceived(file){saveBlob(new Blob([file.bytes],{type:file.type}),file.downloadName);}
  function makeReceivedZip(files){
    if(files.length>65535)throw Error('Too many files for one ZIP.');
    const local=[],central=[],used=new Set(),encoder=new TextEncoder();let offset=0,centralSize=0;
    for(const file of files){
      const original=file.zipName,slash=original.lastIndexOf('/'),dot=original.lastIndexOf('.'),split=dot>slash?dot:original.length;
      let name=original;for(let copy=2;used.has(name);copy++)name=original.slice(0,split)+` (${copy})`+original.slice(split);
      used.add(name);const encoded=encoder.encode(name),data=file.bytes;
      if(encoded.length>65535||data.length>0xffffffff||offset+30+encoded.length+data.length>0xffffffff)throw Error('Selected files exceed ZIP size limits.');
      const crc=c.crc32(data),head=new Uint8Array(30),h=new DataView(head.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,encoded.length,true);
      local.push(head,encoded,data);
      const record=new Uint8Array(46),r=new DataView(record.buffer);
      r.setUint32(0,0x02014b50,true);r.setUint16(4,20,true);r.setUint16(6,20,true);r.setUint16(8,0x0800,true);r.setUint32(16,crc,true);r.setUint32(20,data.length,true);r.setUint32(24,data.length,true);r.setUint16(28,encoded.length,true);r.setUint32(42,offset,true);
      central.push(record,encoded);centralSize+=record.length+encoded.length;offset+=head.length+encoded.length+data.length;
    }
    if(offset+centralSize+22>0xffffffff)throw Error('Selected files exceed ZIP size limits.');
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    return new Blob([...local,...central,end],{type:'application/zip'});
  }
  function updateReceivedActions(){const count=selectedReceived.size;$('selectAllReceived').disabled=!receivedFiles.length||count===receivedFiles.length;$('deselectAllReceived').disabled=!count;$('downloadSelected').disabled=!count;$('removeSelected').disabled=!count;$('receivedStatus').textContent=receivedFiles.length?`${receivedFiles.length} file${receivedFiles.length===1?'':'s'} received · ${count} selected.`:'No files received.';}
  function receivedTime(date){const pad=value=>String(value).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;}
  function renderReceivedFiles(){
    const list=$('receivedList'),fragment=document.createDocumentFragment();
    for(const file of [...receivedFiles].reverse()){
      const row=document.createElement('li');row.dataset.id=String(file.id);
      const check=document.createElement('input');check.type='checkbox';check.checked=selectedReceived.has(file.id);check.setAttribute('aria-label','Select '+file.name);check.onchange=()=>{if(check.checked)selectedReceived.add(file.id);else selectedReceived.delete(file.id);updateReceivedActions();};
      const name=document.createElement('span');name.className='received-name';name.textContent=file.name;
      const detail=document.createElement('small');detail.textContent=`${receivedTime(file.receivedAt)} · ${file.protocol} · ${file.bytes.length.toLocaleString()} bytes`;name.append(detail);
      const actions=document.createElement('span');actions.className='received-actions';
      if(file.site){const open=document.createElement('button');open.type='button';open.className='secondary';open.textContent='Open site';open.setAttribute('aria-label','Open site '+file.name);open.onclick=()=>openSite(file);actions.append(open);}
      const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Download';button.setAttribute('aria-label','Download '+file.name);button.onclick=()=>saveReceived(file);
      actions.append(button);row.append(check,name,actions);fragment.append(row);
    }
    list.replaceChildren(fragment);updateReceivedActions();
  }
  function rememberFile(file,name,protocol,site=null){
    const type=mime(name,file.type||''),basename=name.split('/').pop(),addTxt=type==='text/plain'&&!basename.includes('.');
    const record={id:++nextReceivedId,name,downloadName:basename+(addTxt?'.txt':''),zipName:name+(addTxt?'.txt':''),type,bytes:file.bytes,protocol,receivedAt:new Date(),site:null};
    const found=websiteSite(name,type,file.bytes,site);
    if(found instanceof Promise)found.then(value=>{if(value&&receivedFiles.includes(record)){record.site=value;renderReceivedFiles();}});
    else record.site=found;
    receivedFiles.push(record);
  }
  $('selectAllReceived').onclick=()=>{for(const file of receivedFiles)selectedReceived.add(file.id);for(const check of $('receivedList').querySelectorAll('input[type="checkbox"]'))check.checked=true;updateReceivedActions();};
  $('deselectAllReceived').onclick=()=>{selectedReceived.clear();for(const check of $('receivedList').querySelectorAll('input[type="checkbox"]'))check.checked=false;updateReceivedActions();};
  $('downloadSelected').onclick=()=>{
    const files=receivedFiles.filter(file=>selectedReceived.has(file.id));if(!files.length)return;
    try{if(files.length===1)saveReceived(files[0]);else saveBlob(makeReceivedZip(files),'apocalipse-received-files.zip');}
    catch(error){log('ERROR',error.message,'FILES');$('receivedStatus').textContent=error.message;}
  };
  $('removeSelected').onclick=()=>{receivedFiles=receivedFiles.filter(file=>!selectedReceived.has(file.id));selectedReceived.clear();renderReceivedFiles();};
  function siteLinkTarget(site,pagePath,href){const path=c.resolvePath(pagePath,href),entry=path&&site.files.find(file=>file.path===path);return entry&&/\.html?$/i.test(path)&&utf8(entry.bytes)!==null?path:null;}
  function htmlPreview(lane,html,site=null){
    const frame=document.createElement('iframe');frame.title='Received HTML';frame.srcdoc=html;
    if(site){let pagePath=site.entry;frame.addEventListener('load',()=>{frame.contentDocument?.addEventListener('click',event=>{const link=event.target.closest?.('a[href]'),target=link&&siteLinkTarget(site,pagePath,link.getAttribute('href'));if(!target)return;const page=siteMarkup(site,dataUrl,target);if(!page)return;event.preventDefault();pagePath=target;frame.srcdoc=page;},true);});}
    $('preview-'+lane.id).append(frame);
  }
  function siteMarkup(site,makeAssetUrl,pagePath=site.entry){
    const files=new Map(site.files.map(file=>[file.path,file])),urls=new Map();
    function rewriteCss(css,base,stack=[]){
      css=css.replace(/@import\s+(['"])([^'"]+)\1/gi,(original,_quote,ref)=>{const target=c.resolvePath(base,ref),url=target?asset(target,stack):null;return url?`@import url("${url}")`:original;});
      return css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi,(original,_quote,ref)=>{const target=c.resolvePath(base,ref),url=target?asset(target,stack):null;return url?`url("${url}")`:original;});
    }
    function asset(path,stack=[]){
      if(urls.has(path))return urls.get(path);
      if(stack.includes(path)||!files.has(path))return null;
      const entry=files.get(path);let data=entry.bytes;
      if(/\.css$/i.test(path)){const css=utf8(data);if(css!==null)data=new TextEncoder().encode(rewriteCss(css,path,[...stack,path]));}
      const url=makeAssetUrl(data,mime(path));urls.set(path,url);return url;
    }
    const page=files.get(pagePath),text=page&&utf8(page.bytes);if(text===null||text===undefined)return null;
    const doc=new DOMParser().parseFromString(text,'text/html');
    for(const el of doc.querySelectorAll('*'))for(const attr of [...el.attributes]){
      const key=attr.name.toLowerCase();
      if(key==='style')el.setAttribute(attr.name,rewriteCss(attr.value,pagePath));
      else if(['src','href','poster','data'].includes(key)){
        const target=c.resolvePath(pagePath,attr.value);
        if(!target||!files.has(target))continue;
        if(key==='href'&&el.tagName==='A'&&siteLinkTarget(site,pagePath,attr.value))continue;
        else{const url=asset(target);if(url)el.setAttribute(attr.name,url);}
      }
    }
    for(const style of doc.querySelectorAll('style'))style.textContent=rewriteCss(style.textContent,pagePath);
    return doc.documentElement.outerHTML;
  }
  function openSite(file){
    try{
      const escape=value=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const pages=Object.create(null),links=Object.create(null);
      for(const entry of file.site.files){
        if(!/\.html?$/i.test(entry.path))continue;
        const markup=siteMarkup(file.site,dataUrl,entry.path);if(!markup)continue;
        pages[entry.path]='<!doctype html>'+markup;
        links[entry.path]=Object.create(null);
        const doc=new DOMParser().parseFromString(markup,'text/html');
        for(const anchor of doc.querySelectorAll('a[href]')){const href=anchor.getAttribute('href'),target=siteLinkTarget(file.site,entry.path,href);if(target)links[entry.path][href]=target;}
      }
      if(!Object.hasOwn(pages,file.site.entry))throw Error('The site entry page cannot be opened.');
      const safeJson=value=>JSON.stringify(value).replace(/</g,'\\u003c');
      for(const path of Object.keys(pages)){
        const helperCode=`const localLinks=${safeJson(links[path])};document.addEventListener('click',event=>{const link=event.target.closest?.('a[href]'),href=link?.getAttribute('href');if(!Object.hasOwn(localLinks,href))return;event.preventDefault();parent.postMessage({type:'apocalipse-site-link',href},'*');},true);`;
        const helper='<script>'+helperCode+'</scr'+'ipt>';
        pages[path]=pages[path].replace(/<head\b[^>]*>/i,opening=>opening+helper);
      }
      const viewer=`const pages=${safeJson(pages)},links=${safeJson(links)},frame=document.querySelector('iframe'),urls=Object.create(null);let current;function show(path){if(!Object.hasOwn(pages,path))return;current=path;frame.dataset.page=path;urls[path]??=URL.createObjectURL(new Blob([pages[path]],{type:'text/html;charset=utf-8'}));frame.src=urls[path];}addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.data?.type!=='apocalipse-site-link')return;const target=links[current]?.[event.data.href];if(target)show(target);});addEventListener('pagehide',()=>{for(const url of Object.values(urls))URL.revokeObjectURL(url);});show(${safeJson(file.site.entry)});`;
      const wrapper=`<!doctype html><html><head><meta charset="utf-8"><title>${escape(file.name)}</title><style>html,body{margin:0;width:100%;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe title="${escape(file.name)}"></iframe><script>${viewer}</scr`+'ipt></body></html>';
      const url=URL.createObjectURL(new Blob([wrapper],{type:'text/html;charset=utf-8'}));window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(error){log('ERROR',error.message,'FILES');$('receivedStatus').textContent=error.message;}
  }
  function showFile(lane,file){
    clearPreview(lane);const box=$('preview-'+lane.id),type=mime(file.name,file.type),label=document.createElement('p');label.textContent=`${file.name} · ${type} · ${file.bytes.length.toLocaleString()} bytes`;box.append(label);
    const name=type==='text/plain'&&!file.name.includes('.')?file.name+'.txt':file.name;downloadButton(lane,name,file.bytes,file.type);
    const text=utf8(file.bytes);
    if(type==='text/html'&&text!==null)htmlPreview(lane,text);
    else if(text!==null&&(type.startsWith('text/')||['application/json','application/xml','image/svg+xml'].includes(type))){const pre=document.createElement('pre');pre.textContent=text;box.append(pre);}
    else if(/^image\/(png|jpeg|gif|webp|bmp)$/.test(type)){const img=document.createElement('img');img.alt=file.name;img.src=objectUrl(lane,file.bytes,type);box.append(img);}
    else if(/^(audio|video)\/(mpeg|wav|ogg|mp4|webm)$/.test(type)){const media=document.createElement(type.startsWith('audio/')?'audio':'video');media.controls=true;media.preload='none';media.src=objectUrl(lane,file.bytes,type);box.append(media);}
  }
  function showSite(lane,site){
    clearPreview(lane);const box=$('preview-'+lane.id),notice=document.createElement('p');notice.textContent=`Legacy APW1 site · ${site.files.length} reconstructed files. Original ZIP bytes are unavailable.`;box.append(notice);
    const markup=siteMarkup(site,dataUrl,site.entry);if(markup)htmlPreview(lane,markup,site);
    for(const entry of site.files)downloadButton(lane,entry.path,entry.bytes,mime(entry.path),site);
  }
  function resetLane(lane,keepPreview=false){lane.generation++;lane.decoder?.dispose?.();lane.decoder=null;lane.receiver=new c.EnhancedTransferReceiver();lane.raw='';$('progress-'+lane.id).value=0;$('progress-'+lane.id).max=1;$('progress-'+lane.id).hidden=true;if(!keepPreview)clearPreview(lane);renderReceiverDetail();}
  function frameFor(lane,frame){if(!rx||!$('enable-'+lane.id).checked)return;const receiver=lane.receiver,before=receiver.completed;
    if(!receiver.acceptFrame(frame)){log('WARNING','Rejected packet or checksum.',m.protocol(lane.id).label);return;}
    const p=receiver.progress(),progress=$('progress-'+lane.id);progress.max=p.total||1;progress.value=p.received;progress.hidden=!p.received;
    setLaneStatus(lane,p.complete?'Validated transfer complete.':`Receiving ${p.received}/${p.total} packets.`);
    if(receiver.completed!==before){const result=receiver.completed,protocol=m.protocol(lane.id).label;log('SUCCESS',result.kind==='file'?`Validated ${result.value.name}`:`Validated legacy site ${result.value.entry}`,protocol);if(result.kind==='file'){showFile(lane,result.value);rememberFile(result.value,result.value.name,protocol);}else{showSite(lane,result.value);for(const file of result.value.files)rememberFile(file,file.path,protocol,result.value);}renderReceivedFiles();renderReceiverDetail();}
  }
  async function startLane(lane,session){
    if(!$('enable-'+lane.id).checked||!session.context)return;const generation=++lane.generation;
    setLaneStatus(lane,'Starting decoder…');
    try{
      const decoder=await m.createDecoder(lane.id,session.context.sampleRate,frame=>{if(rx===session&&lane.generation===generation)frameFor(lane,frame);},event=>{if(rx!==session||lane.generation!==generation)return;if(event.text!==undefined){lane.raw+=event.text;if(lane.raw.includes('\n')||lane.raw.length>=256){log('RAW',JSON.stringify(lane.raw),m.protocol(lane.id).label);lane.raw='';}}else log(event.level,event.message,m.protocol(lane.id).label);});
      if(rx!==session||lane.generation!==generation||!$('enable-'+lane.id).checked){decoder.dispose?.();return;}lane.decoder=decoder;setLaneStatus(lane,'Listening for packets.');
    }catch(e){if(rx===session&&lane.generation===generation){setLaneStatus(lane,'Decoder error: '+e.message);log('ERROR',e.message,m.protocol(lane.id).label);}}
  }
  for(const lane of Object.values(lanes))$('enable-'+lane.id).onchange=()=>{const enabled=$('enable-'+lane.id).checked;$('lane-'+lane.id).setAttribute('aria-disabled',String(!enabled));resetLane(lane);setLaneStatus(lane,enabled?'Waiting for audio.':'Disabled.');if(enabled&&rx)startLane(lane,rx);};
  function stopRx(){if(!rx)return;const s=rx;rx=null;for(const lane of Object.values(lanes)){lane.generation++;lane.decoder?.dispose?.();lane.decoder=null;lane.raw='';if($('enable-'+lane.id).checked)setLaneStatus(lane,'Microphone stopped.');}ApocalypseCapture.dispose(s.node);s.source?.disconnect();s.sink?.disconnect();s.stream?.getTracks().forEach(t=>t.stop());s.context?.close().catch(()=>{});if(waveFrame)cancelAnimationFrame(waveFrame);waveFrame=0;draw(null);$('level').style.width='0';$('receive').disabled=false;$('stopReceive').disabled=true;$('rxStatus').textContent='Microphone stopped.';}
  $('receive').onclick=async()=>{
    if(rx)return;const s=rx={};$('receive').disabled=true;$('stopReceive').disabled=false;
    try{
      $('rxStatus').textContent='Starting microphone…';if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access is unavailable in this browser.');
      const context=s.context=new (window.AudioContext||window.webkitAudioContext)();await context.resume();if(rx!==s)return;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});if(rx!==s){stream.getTracks().forEach(t=>t.stop());return;}s.stream=stream;
      for(const lane of Object.values(lanes))if($('enable-'+lane.id).checked)startLane(lane,s);
      const source=s.source=context.createMediaStreamSource(stream);
      const node=await ApocalypseCapture.create(context,samples=>{
        if(rx!==s)return;let peak=0;for(const x of samples)peak=Math.max(peak,Math.abs(x));$('level').style.width=Math.min(100,peak*100)+'%';
        if(!waveFrame){const snapshot=samples.slice();waveFrame=requestAnimationFrame(()=>{waveFrame=0;draw(snapshot);});}
        for(const lane of Object.values(lanes))if(lane.decoder&&$('enable-'+lane.id).checked){try{lane.decoder.feed(samples);}catch(e){lane.generation++;lane.decoder.dispose?.();lane.decoder=null;setLaneStatus(lane,'Decoder error: '+e.message);log('ERROR',e.message,m.protocol(lane.id).label);}}
      },(level,message)=>{if(rx===s)log(level,message,'AUDIO');});
      if(rx!==s){ApocalypseCapture.dispose(node);return;}s.node=node;source.connect(node);if(node.numberOfOutputs){const sink=s.sink=context.createGain();sink.gain.value=0;node.connect(sink).connect(context.destination);}
      $('rxStatus').textContent='Listening on enabled lanes.';log('INFO','Microphone active; one capture stream feeds all enabled decoders.','AUDIO');
    }catch(e){if(rx===s){stopRx();$('rxStatus').textContent=e.message;log('ERROR',e.message,'AUDIO');}}
  };
  $('stopReceive').onclick=stopRx;
  window.addEventListener('pagehide',()=>{stopTx();stopRx();for(const lane of Object.values(lanes))clearPreview(lane);});
})();

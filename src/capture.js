(function(global){
  'use strict';
  // Keep capture on the rendering thread. Transferred blocks remain queued when
  // decoding, layout, or a background tab delays the main thread.
  const workletSource=`
    class PacketCapture extends AudioWorkletProcessor {
      constructor(){super();this.block=new Float32Array(4096);this.used=0;this.start=0;}
      process(inputs){
        const samples=inputs[0]?.[0];
        if(samples)for(let i=0;i<samples.length;i++){
          if(!this.used)this.start=currentFrame+i;
          this.block[this.used++]=samples[i];
          if(this.used===this.block.length){
            this.port.postMessage({samples:this.block,frame:this.start},[this.block.buffer]);
            this.block=new Float32Array(4096);this.used=0;
          }
        }
        return true;
      }
    }
    registerProcessor('packet-capture',PacketCapture);
  `;
  async function create(context,onSamples,onEvent=()=>{}){
    let node;
    if(context.audioWorklet&&global.AudioWorkletNode){
      // A data URL also works for opaque file:// origins, where Chromium can
      // reject blob URL module loads. No server or extra file is required.
      const url='data:text/javascript;charset=utf-8,'+encodeURIComponent(workletSource);
      try{
        await context.audioWorklet.addModule(url);
        // A capture-only node is automatically pulled without a speaker
        // connection. A muted destination lets Chromium switch to a different
        // clock after 30 seconds of silence, which can drop live input samples.
        node=new AudioWorkletNode(context,'packet-capture',{numberOfInputs:1,numberOfOutputs:0,channelCount:1,channelCountMode:'explicit'});
      }catch(error){onEvent('WARNING','AudioWorklet unavailable: '+error.message);}
    }
    let nextFrame=null,lastWarning=-Infinity,timing=null,totalSamples=0;
    const deliver=(samples,frame)=>{
      if(nextFrame!==null&&frame-nextFrame>1)onEvent('WARNING',`Capture gap: ${Math.round(frame-nextFrame)} samples missing. Reception may need another pass.`);
      nextFrame=frame+samples.length;
      totalSamples+=samples.length;
      // Comparing two audio clocks cannot detect the entire graph slowing
      // down. Also measure against the independent monotonic wall clock.
      const now=performance.now();
      if(!timing)timing={wall:now,audio:context.currentTime,samples:totalSamples};
      if(now-timing.wall>=10000){
        const wall=(now-timing.wall)/1000,audio=(totalSamples-timing.samples)/context.sampleRate,clock=context.currentTime-timing.audio;
        if(audio/wall>=.9&&audio/wall<=1.1&&clock/wall>=.9&&clock/wall<=1.1)onEvent('INFO','Microphone capture check working');
        if(audio/wall<.9||audio/wall>1.1)onEvent('WARNING',`Microphone capture is running at ${Math.round(audio/wall*100)}% of real time. Live audio may be lost or distorted.`);
        if(clock/wall<.9||clock/wall>1.1)onEvent('WARNING',`Audio clock is running at ${Math.round(clock/wall*100)}% of real time. Live microphone audio may be lost or distorted.`);
        timing={wall:now,audio:context.currentTime,samples:totalSamples};
      }
      const lag=context.currentTime-nextFrame/context.sampleRate;
      if(lag>1&&context.currentTime-lastWarning>10){lastWarning=context.currentTime;onEvent('WARNING',`Audio processing is ${lag.toFixed(1)}s behind capture; queued samples are still being decoded.`);}
      onSamples(samples);
    };
    if(node){
      node.port.onmessage=e=>deliver(e.data.samples,e.data.frame);
      node.onprocessorerror=()=>onEvent('ERROR','Microphone capture processor failed. Stop and restart the microphone.');
      onEvent('INFO','Capture: AudioWorklet (capture-only, no speaker connection; queued audio).');
    }else{
      node=context.createScriptProcessor(4096,1,1);
      node.onaudioprocess=e=>deliver(e.inputBuffer.getChannelData(0),Math.round((e.playbackTime-4096/context.sampleRate)*context.sampleRate));
      onEvent('WARNING','Capture: ScriptProcessor fallback. Keep this tab visible; page stalls can lose microphone samples.');
    }
    return node;
  }
  function dispose(node){
    if(!node)return;
    node.onaudioprocess=null;node.onprocessorerror=null;
    if(node.port){node.port.onmessage=null;node.port.close();}
    node.disconnect();
  }
  global.ApocalypseCapture={create,dispose,workletSource};
})(globalThis);

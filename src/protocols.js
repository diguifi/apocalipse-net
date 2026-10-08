(function(global) {
  'use strict';
  const c = global.ApocalypseCore;
  const PROTOCOLS = Object.freeze({
    ax25: {label:'AX.25', detail:'Bell 202 AFSK · 1200 baud', waveRate:12000,
      help:'1200 baud packet radio. Best with a clean audio path; packets repeat until stopped.'},
    mt63: {label:'MT63-2000L', detail:'2000 Hz bandwidth · long interleave · error correction', waveRate:8000,
      help:'MT63-2000L uses error correction and long interleaving. Allow several seconds for the receiver to synchronize.'},
    mfsk: {label:'multi-tone FSK', detail:'4 tones · 25 symbols/s · error correction', waveRate:8000,
      help:'Slow, distinct tones with error correction. This app’s custom four-tone format trades speed for longer symbols.'}
  });
  function protocol(id) { if (!PROTOCOLS[id]) throw Error('Unknown protocol: '+id); return PROTOCOLS[id]; }
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    let out='';
    for(let i=0;i<bytes.length;i+=3){const v=bytes[i]<<16|(bytes[i+1]||0)<<8|(bytes[i+2]||0);out+=alphabet[v>>>18]+alphabet[v>>>12&63]+(i+1<bytes.length?alphabet[v>>>6&63]:'=')+(i+2<bytes.length?alphabet[v&63]:'=');}
    return out;
  }
  function unbase64(text) {
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))return null;
    const out=[];
    for(let i=0;i<text.length;i+=4){const v=alphabet.indexOf(text[i])<<18|alphabet.indexOf(text[i+1])<<12|Math.max(0,alphabet.indexOf(text[i+2]))<<6|Math.max(0,alphabet.indexOf(text[i+3]));out.push(v>>>16&255);if(text[i+2]!=='=')out.push(v>>>8&255);if(text[i+3]!=='=')out.push(v&255);}
    return Uint8Array.from(out);
  }
  // Printable, bounded application records on the standard MT63 character stream.
  // The contained AX.25 FCS protects the complete record, including its session header.
  function mt63Bursts(frames) {
    // Preserve the carrier clock and interleaver across packet boundaries.
    // Limit each native call to less than its ten-minute initial audio buffer.
    const bursts=[];let body='';
    const flush=()=>{if(body){bursts.push(' '.repeat(80)+'\n'+body+' '.repeat(24));body='';}};
    for(const frame of frames){const record='~APW1:'+base64(frame)+'\n';if(body.length+record.length>7600)flush();body+=record;}
    flush();return bursts;
  }
  function mt63Text(frame) { return mt63Bursts([frame])[0]; }
  class TextFrames {
    constructor(onFrame,onEvent=()=>{}){this.pending='';this.onFrame=onFrame;this.onEvent=onEvent;this.characters=0;this.records=0;this.rejected=0;}
    feed(text){
      this.characters+=text.length;
      this.pending+=text;
      let end;
      while((end=this.pending.indexOf('\n'))>=0){
        const line=this.pending.slice(0,end).replace(/\r$/,'');this.pending=this.pending.slice(end+1);
        const at=line.lastIndexOf('~APW1:');
        if(at>=0){this.records++;const encoded=line.slice(at+6),frame=encoded.length<=368?unbase64(encoded):null;if(frame&&c.parseFrame(frame))this.onFrame(frame);else{this.rejected++;this.onEvent({level:'WARNING',message:'Rejected MT63 record: invalid encoding or frame checksum.'});}}
      }
      if(this.pending.length>400)this.pending=this.pending.slice(-400);
    }
  }
  // Fractional sample positions survive callback boundaries. A windowed-sinc
  // low-pass filter suppresses aliases before downsampling microphone input.
  class Resampler {
    constructor(inputRate,outputRate){
      if(inputRate<=0||outputRate<=0)throw Error('Invalid sample rate');
      this.same=inputRate===outputRate;this.ratio=inputRate/outputRate;this.next=16;this.outputIndex=0;this.origin=0;this.data=Array(32).fill(0);
      const cutoff=.45*Math.min(1,outputRate/inputRate);this.weights=[];
      for(let phase=0;phase<256;phase++){
        const w=new Float64Array(32);let sum=0;
        for(let k=0;k<32;k++){const x=k-15-phase/256;const sinc=x===0?2*cutoff:Math.sin(2*Math.PI*cutoff*x)/(Math.PI*x);w[k]=sinc*(.5+.5*Math.cos(Math.PI*x/16));sum+=w[k];}
        for(let k=0;k<32;k++)w[k]/=sum;this.weights.push(w);
      }
    }
    feed(samples){
      if(this.same)return samples;
      for(const x of samples)this.data.push(x);
      const out=[];
      while(this.next+16<this.data.length){const center=Math.floor(this.next),weights=this.weights[Math.floor((this.next-center)*256)];let x=0;for(let k=0;k<32;k++)x+=this.data[center-15+k]*weights[k];out.push(x);this.next=16+(++this.outputIndex)*this.ratio-this.origin;}
      const drop=Math.max(0,Math.floor(this.next)-16);this.data.splice(0,drop);this.origin+=drop;this.next=16+this.outputIndex*this.ratio-this.origin;
      return Float32Array.from(out);
    }
  }
  class MT63Encoder {
    constructor(frames,rate,repeat,module){this.bursts=mt63Bursts(frames);this.rate=rate;this.repeat=repeat;this.module=module;this.encode=module.cwrap('encodeString','number',['string','number','number']);this.index=0;this.samples=null;this.at=0;this.done=false;this.total=this.bursts.reduce((sum,text)=>sum+1.984+(text.length+65)/20,0);}
    duration(){return this.total;}
    load(){
      if(this.index===this.bursts.length){if(!this.repeat){this.done=true;return;}this.index=0;}
      if(this.bursts.length===1&&this.samples){this.at=0;this.index++;return;}
      const length=this.encode(this.bursts[this.index++],2000,1),ptr=this.module._getBuffer();
      if(!length)throw Error('MT63 encoding failed');
      this.samples=this.module.HEAPF32.slice(ptr/4,ptr/4+length);this.at=0;
    }
    fill(out){
      for(let i=0;i<out.length;i++){
        if(!this.samples||this.at>=this.samples.length){this.load();if(this.done){out.fill(0,i);return out;}}
        const at=Math.floor(this.at),fraction=this.at-at;
        out[i]=this.samples[at]*(1-fraction)+(this.samples[at+1]||0)*fraction;this.at+=8000/this.rate;
      }
      return out;
    }
    dispose(){this.module=null;this.samples=null;this.encode=null;}
  }
  class MT63Decoder {
    constructor(rate,onFrame,module,onEvent=()=>{}){
      // Do not gate the character stream on FEC_SNR: a short dip can discard
      // correct characters and make a whole packet fail. FCS/CRC validation
      // rejects bad records without deleting potentially recoverable data.
      this.module=module;module._initRx(2000,1,16,0);this.process=module.cwrap('processAudio','string',['number','number']);
      this.ptr=module._malloc(1024*4);this.pending=new Float32Array(1024);this.used=0;this.resampler=new Resampler(rate,8000);this.text=new TextFrames(onFrame,onEvent);this.onEvent=onEvent;this.level=0;
    }
    feed(samples){
      this.level=rms(samples);
      for(const x of this.resampler.feed(samples)){this.pending[this.used++]=x;if(this.used===1024){this.module.HEAPF32.set(this.pending,this.ptr/4);const text=this.process(this.ptr,1024);if(text)this.onEvent({level:'DATA',text});this.text.feed(text);this.used=0;}}
    }
    diagnostics(){return {characters:this.text.characters,records:this.text.records,rejected:this.text.rejected};}
    dispose(){if(this.module)this.module._free(this.ptr);this.module=null;this.process=null;}
  }
  function rms(samples){let sum=0;for(const x of samples)sum+=x*x;return Math.sqrt(sum/(samples.length||1));}
  // Hamming(7,4), interleaved over eight codewords: adjacent tone errors affect
  // different codewords. The existing frame FCS rejects uncorrectable packets.
  function hamming(n){const a=n&1,b=n>>1&1,d=n>>2&1,e=n>>3&1;return (a^b^e)|((a^d^e)<<1)|(a<<2)|((b^d^e)<<3)|(b<<4)|(d<<5)|(e<<6);}
  function unhamming(word){const bit=p=>word>>(p-1)&1;const s=(bit(1)^bit(3)^bit(5)^bit(7))|((bit(2)^bit(3)^bit(6)^bit(7))<<1)|((bit(4)^bit(5)^bit(6)^bit(7))<<2);if(s)word^=1<<(s-1);return (word>>2&1)|(word>>3&2)|(word>>3&4)|(word>>3&8);}
  function fecSymbols(bytes){
    const symbols=[];
    for(let at=0;at<bytes.length;at+=4){const words=[];for(let i=0;i<4;i++){const b=bytes[at+i]||0;words.push(hamming(b&15),hamming(b>>4));}const bits=[];for(let bit=0;bit<7;bit++)for(const w of words)bits.push(w>>bit&1);for(let i=0;i<bits.length;i+=2)symbols.push(bits[i]|bits[i+1]<<1);}
    return symbols;
  }
  function unfec(symbols){
    const out=[];
    for(let at=0;at<symbols.length;at+=28){const words=Array(8).fill(0);for(let bit=0;bit<56;bit++){const v=symbols[at+(bit>>1)]>>(bit&1)&1;words[bit%8]|=v<<Math.floor(bit/8);}for(let i=0;i<8;i+=2)out.push(unhamming(words[i])|unhamming(words[i+1])<<4);}
    return Uint8Array.from(out);
  }
  const SYNC=[0,3,1,0,2,3,2,1,3,0,1,2,0,2,1,3,1,2,3,0,3,2,0,1];
  const TONES=[700,1100,1500,1900], SYMBOL_RATE=25;
  function mfskSymbols(frame){const n=frame.length;return [...Array.from({length:16},(_,i)=>i%2?3:0),...SYNC,...fecSymbols(Uint8Array.of(n&255,n>>8,(n&255)^255,(n>>8)^255)),...fecSymbols(frame)];}
  class FSKEncoder {
    constructor(frames,rate,repeat){this.frames=frames;this.rate=rate;this.repeat=repeat;this.index=0;this.symbols=null;this.symbol=0;this.time=0;this.phase=0;this.done=false;}
    duration(){return duration('mfsk',this.frames);}
    load(){if(this.index===this.frames.length){if(!this.repeat){this.done=true;return;}this.index=0;}this.symbols=[...Array(5).fill(-1),...mfskSymbols(this.frames[this.index++]),...Array(5).fill(-1)];this.symbol=0;}
    fill(out){for(let i=0;i<out.length;i++){if(!this.symbols||this.symbol>=this.symbols.length){this.load();if(this.done){out.fill(0,i);return out;}}const tone=this.symbols[this.symbol];const edge=Math.min(1,this.time/.05,(1-this.time)/.05);out[i]=tone<0?0:Math.sin(this.phase)*.75*Math.max(0,edge);if(tone>=0){this.phase+=2*Math.PI*TONES[tone]/this.rate;if(this.phase>2*Math.PI)this.phase-=2*Math.PI;}this.time+=SYMBOL_RATE/this.rate;if(this.time>=1){this.time-=1;this.symbol++;}}return out;}
    dispose(){}
  }
  class SymbolLane {
    constructor(onFrame,onEvent){this.onFrame=onFrame;this.onEvent=onEvent;this.reset();}
    reset(){this.history=[];this.payload=null;this.length=0;this.target=28;}
    feed(symbol){
      if(!this.payload){this.history.push(symbol);if(this.history.length>SYNC.length)this.history.shift();if(this.history.length===SYNC.length&&this.history.every((s,i)=>s===SYNC[i])){this.payload=[];this.history=[];}return;}
      this.payload.push(symbol<0?0:symbol);
      if(this.payload.length!==this.target)return;
      if(!this.length){const h=unfec(this.payload),n=h[0]|h[1]<<8;if((h[0]^h[2])!==255||(h[1]^h[3])!==255||n<18||n>274){this.onEvent({level:'WARNING',message:'Rejected FSK candidate: invalid packet length/header.'});this.reset();return;}this.length=n;this.target=Math.ceil(n/4)*28;this.payload=[];}
      else{const frame=unfec(this.payload).slice(0,this.length);if(c.parseFrame(frame))this.onFrame(frame);else this.onEvent({level:'WARNING',message:'Rejected FSK candidate: frame checksum failed.',bytes:frame});this.reset();}
    }
  }
  class FSKDecoder {
    constructor(rate,onFrame,onEvent=()=>{}){
      this.resampler=new Resampler(rate,8000);this.level=0;this.buffer=new Float32Array(160);this.count=0;this.tick=0;this.seen=[];
      this.lanes=Array.from({length:8},()=>new SymbolLane(frame=>{const key=base64(frame);if(!this.seen.includes(key)){this.seen.push(key);if(this.seen.length>32)this.seen.shift();onFrame(frame);}},onEvent));
      this.coefficients=TONES.map(f=>2*Math.cos(2*Math.PI*f/8000));
    }
    feed(samples){
      this.level=rms(samples);
      for(const x of this.resampler.feed(samples)){
        this.buffer[this.count%160]=x;this.count++;
        if(this.count<160||this.count%40)continue;
        const energies=this.coefficients.map(coefficient=>{let q1=0,q2=0;for(let j=0;j<160;j++){const q=this.buffer[(this.count+j)%160]+coefficient*q1-q2;q2=q1;q1=q;}return Math.max(0,q1*q1+q2*q2-coefficient*q1*q2);});
        const peak=Math.max(...energies),sum=energies.reduce((a,b)=>a+b,0),symbol=peak>1e-7&&peak>sum*.55?energies.indexOf(peak):-1;
        this.lanes[this.tick++%8].feed(symbol);
      }
    }
    dispose(){}
  }
  function duration(id,frames){
    protocol(id);
    if(id==='ax25')return new c.AudioEncoder(frames,12000,false).duration();
    if(id==='mt63')return mt63Bursts(frames).reduce((sum,text)=>sum+1.984+(text.length+65)/20,0);
    return frames.reduce((sum,f)=>sum+(10+mfskSymbols(f).length)/SYMBOL_RATE,0);
  }
  async function createEncoder(id,frames,rate,repeat=true){
    protocol(id);if(!frames.length)throw Error('No packets to send');
    if(id==='ax25')return new c.AudioEncoder(frames,rate,repeat);
    if(id==='mfsk')return new FSKEncoder(frames,rate,repeat);
    const encoder=new MT63Encoder(frames,rate,repeat,await global.createMT63Module());
    // Render the first burst before the audio callback starts. A single-burst
    // repeated pass reuses its PCM, so encoding cannot interrupt that loop.
    encoder.load();return encoder;
  }
  async function createDecoder(id,rate,onFrame,onEvent=()=>{}){
    protocol(id);if(id==='ax25')return new c.AudioDecoder(rate,onFrame);
    if(id==='mfsk')return new FSKDecoder(rate,onFrame,onEvent);
    return new MT63Decoder(rate,onFrame,await global.createMT63Module(),onEvent);
  }
  global.ApocalypseModems={PROTOCOLS,protocol,duration,createEncoder,createDecoder,Resampler,TextFrames,mt63Text,mt63Bursts,fecSymbols,unfec};
})(globalThis);

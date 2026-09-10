export function encodeWav(chunks, sampleRate) {
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('The microphone sample rate is unsupported.');
  const length=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
  if(!length||length>sampleRate*120)throw new Error('Record a phrase of up to two minutes.');
  const input=new Float32Array(length);let offset=0;
  chunks.forEach(chunk=>{input.set(chunk,offset);offset+=chunk.length;});
  const count=Math.floor(length*16000/sampleRate),buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
  const word=(at,text)=>[...text].forEach((letter,i)=>view.setUint8(at+i,letter.charCodeAt(0)));
  word(0,'RIFF');view.setUint32(4,36+count*2,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){
    const begin=Math.floor(i*sampleRate/16000),end=Math.max(begin+1,Math.floor((i+1)*sampleRate/16000));let sum=0,n=0;
    for(let j=begin;j<Math.min(end,length);j++){sum+=Number.isFinite(input[j])?input[j]:0;n++;}
    const value=Math.max(-1,Math.min(1,n?sum/n:0));view.setInt16(44+i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  return new Uint8Array(buffer);
}

export function createSpeechCapture({onState=()=>{},onLevel=()=>{},onTranscript=()=>{},
  mediaDevices=globalThis.navigator?.mediaDevices, AudioContextClass=globalThis.AudioContext,
  WorkletNodeClass=globalThis.AudioWorkletNode, fetcher=globalThis.fetch?.bind(globalThis)}={}) {
  let state='idle',generation=0,context=null,stream=null,processor=null,source=null,gain=null,chunks=[],frames=0;
  let stopTimer=null,flushed=null,request=null,abort=null;
  const notify=(next,message='')=>{state=next;onState({state,message});};
  const stopTracks=value=>value?.getTracks().forEach(track=>track.stop());
  async function closeGraph(){clearTimeout(stopTimer);stopTracks(stream);stream=null;source?.disconnect();processor?.disconnect();gain?.disconnect();source=null;processor=null;gain=null;const old=context;context=null;await old?.close().catch(()=>{});onLevel(0);}
  async function start(){
    if(!['idle','error'].includes(state))return;
    const current=++generation;notify('requesting');chunks=[];frames=0;
    let acquired=null,localContext=null;
    try{
      if(!mediaDevices?.getUserMedia||!AudioContextClass||!WorkletNodeClass)throw new Error('This browser cannot capture speech. You can still type your message.');
      localContext=new AudioContextClass({sampleRate:16000});context=localContext;
      const resumed=localContext.resume().catch(()=>{});
      acquired=await mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if(current!==generation){stopTracks(acquired);await localContext.close().catch(()=>{});return;}
      stream=acquired;await resumed;
      await localContext.audioWorklet.addModule(new URL('./mic-worklet.js',import.meta.url));
      if(current!==generation){stopTracks(acquired);return;}
      source=localContext.createMediaStreamSource(acquired);processor=new WorkletNodeClass(localContext,'eilo-microphone');gain=localContext.createGain();gain.gain.value=0;
      processor.port.onmessage=event=>{
        if(event.data.flushed){flushed?.();return;}
        if(current!==generation||!['recording','stopping'].includes(state)||!event.data.samples)return;
        const room=localContext.sampleRate*120-frames,part=event.data.samples.subarray(0,Math.max(0,room));
        if(part.length){chunks.push(part);frames+=part.length;onLevel(Number.isFinite(event.data.level)?event.data.level:0);}
        if(frames>=localContext.sampleRate*120&&state==='recording')stop();
      };
      source.connect(processor);processor.connect(gain);gain.connect(localContext.destination);
      acquired.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(state==='recording')stop({cancel:true});},{once:true}));
      notify('recording');stopTimer=setTimeout(()=>stop(),120000);
    }catch(error){
      stopTracks(acquired);
      if(current!==generation)return;
      await closeGraph();notify('error',error.name==='NotAllowedError'?'Microphone access was not granted. Allow it in your browser when you want to use speech.':error.message||'The microphone could not start.');
    }
  }
  async function stop({cancel=false}={}){
    if(['idle','error'].includes(state))return;
    if(state==='requesting'){generation++;await closeGraph();notify('idle');return;}
    if(state==='transcribing'){
      if(!cancel)return;
      generation++;abort?.abort();
      if(request)fetcher('/api/transcribe/cancel',{method:'POST',headers:{'X-Eilo-Client':'local-chat','Content-Type':'application/json'},body:JSON.stringify({request_id:request}),keepalive:true}).catch(()=>{});
      request=null;notify('idle');return;
    }
    if(state==='stopping'){
      if(cancel){generation++;chunks=[];}
      return;
    }
    const current=generation,rate=context?.sampleRate;notify('stopping');
    if(processor&&!cancel)await new Promise(resolve=>{const timeout=setTimeout(resolve,150);flushed=()=>{clearTimeout(timeout);resolve();};processor.port.postMessage('flush');});
    await closeGraph();
    if(cancel||current!==generation){generation++;chunks=[];notify('idle');return;}
    try{
      const wav=encodeWav(chunks,rate);chunks=[];
      let binary='';for(let i=0;i<wav.length;i+=8192)binary+=String.fromCharCode(...wav.subarray(i,i+8192));
      request=crypto.randomUUID();abort=new AbortController();notify('transcribing');
      const response=await fetcher('/api/transcribe',{method:'POST',signal:abort.signal,headers:{'X-Eilo-Client':'local-chat','Content-Type':'application/json'},body:JSON.stringify({request_id:request,audio:btoa(binary)})});
      const result=await response.json();
      if(current!==generation)return;
      if(!response.ok||typeof result.text!=='string')throw new Error(result.error||'Local transcription could not finish.');
      request=null;onTranscript(result.text);notify('idle','Transcript added. Review it before sending.');
    }catch(error){if(current===generation)notify('error',error.message||'Transcription could not finish.');}
    finally{if(current===generation){request=null;abort=null;chunks=[];}}
  }
  return {start,stop,get state(){return state;}};
}

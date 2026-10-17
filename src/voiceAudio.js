export const VOICE_SAMPLE_RATE=16000;
export function mergeVoiceChunks(chunks){
  const total=chunks.reduce((count,chunk)=>count+chunk.length,0);
  const joined=new Float32Array(total);let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  return joined;
}
/** Windowed-sinc low-pass resampling avoids aliasing when a device runs at 44.1/48 kHz. */
export function resampleVoicePcm(samples,sourceRate,targetRate=VOICE_SAMPLE_RATE){
  if(!Number.isFinite(sourceRate)||sourceRate<=0||!Number.isFinite(targetRate)||targetRate<=0)throw new Error('无效的音频采样率');
  if(sourceRate===targetRate)return Float32Array.from(samples);
  const count=Math.floor(samples.length*targetRate/sourceRate),output=new Float32Array(count);
  const ratio=sourceRate/targetRate,cutoff=Math.min(1,targetRate/sourceRate)*.94,radius=20;
  for(let index=0;index<count;index++){
    const center=index*ratio,first=Math.max(0,Math.ceil(center-radius)),last=Math.min(samples.length-1,Math.floor(center+radius));
    let weighted=0,weightSum=0;
    for(let sample=first;sample<=last;sample++){
      const distance=sample-center,argument=Math.PI*distance*cutoff;
      const sinc=Math.abs(argument)<1e-8?1:Math.sin(argument)/argument;
      const window=.5+.5*Math.cos(Math.PI*distance/radius),weight=cutoff*sinc*window;
      weighted+=samples[sample]*weight;weightSum+=weight;
    }
    output[index]=weightSum?weighted/weightSum:0;
  }
  return output;
}
export function encodeVoiceWav(samples,sampleRate=VOICE_SAMPLE_RATE){
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
  const word=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  word(0,'RIFF');view.setUint32(4,36+samples.length*2,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const sample=Math.max(-1,Math.min(1,Number.isFinite(samples[i])?samples[i]:0));view.setInt16(44+i*2,Math.round(sample*(sample<0?32768:32767)),true);}
  return new Uint8Array(buffer);
}
export function voiceBytesToBase64(bytes){
  let binary='';
  for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));
  return btoa(binary);
}
export function voiceBase64ToBlob(base64,mimeType='audio/wav'){
  const decoded=atob(base64),bytes=new Uint8Array(decoded.length);
  for(let index=0;index<decoded.length;index++)bytes[index]=decoded.charCodeAt(index);
  return new Blob([bytes],{type:mimeType});
}

export function splitVoiceReply(text,limit=96){
  if(!Number.isInteger(limit)||limit<20)throw new Error('无效的播报长度');
  const chunks=[];
  let remaining=String(text||'').replace(/\s+/g,' ').trim();
  while(remaining.length>limit){
    const window=remaining.slice(0,limit+1);let cut=limit;
    const boundary=Math.max(window.lastIndexOf('。'),window.lastIndexOf('！'),window.lastIndexOf('？'),window.lastIndexOf('；'),window.lastIndexOf('. '),window.lastIndexOf('! '),window.lastIndexOf('? '));
    if(boundary>=Math.floor(limit*.35)&&boundary<limit)cut=boundary+1;
    else{const pause=Math.max(window.lastIndexOf('，'),window.lastIndexOf(', '),window.lastIndexOf('、'));if(pause>=Math.floor(limit*.6)&&pause<limit)cut=pause+1;}
    const final=remaining.charCodeAt(cut-1);if(final>=0xd800&&final<=0xdbff)cut--;
    const chunk=remaining.slice(0,cut).trim();if(chunk)chunks.push(chunk);remaining=remaining.slice(cut).trim();
  }
  if(remaining)chunks.push(remaining);return chunks;
}

// Float PCM stays local until the user finishes this recording.
class VoicePcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer=new Float32Array(2048);
    this.offset=0;
    this.stopped=false;
    this.port.onmessage=({data})=>{
      if(data?.type==='flush'){
        this.flush();
        this.stopped=true;
        this.port.postMessage({type:'flushed'});
      }
    };
  }
  flush(){
    if(!this.offset)return;
    const samples=this.buffer.slice(0,this.offset);
    let square=0;for(const value of samples)square+=value*value;
    this.port.postMessage({type:'samples',samples,rms:Math.sqrt(square/samples.length)},[samples.buffer]);
    this.offset=0;
  }
  process(inputs){
    if(this.stopped)return false;
    const channels=inputs[0];
    if(!channels?.length)return true;
    const count=channels[0].length;
    for(let index=0;index<count;index++){
      let value=0;
      for(const channel of channels)value+=channel[index]||0;
      this.buffer[this.offset++]=value/channels.length;
      if(this.offset===this.buffer.length)this.flush();
    }
    // The untouched output is silent; microphone audio is never monitored.
    return true;
  }
}
registerProcessor('dkqkar-voice-pcm',VoicePcmCapture);

import { useEffect,useRef,useState } from 'react';
export function useIndustrialCommunication(api){
  const [status,setStatus]=useState(null),[error,setError]=useState('');
  const latest=useRef(null),refresh=useRef(null);
  useEffect(()=>{let stopped=false,timer,controller;
    const poll=async()=>{if(stopped)return;controller=new AbortController();
      try{const value=await api('/communication/status',{signal:controller.signal});if(stopped)return;latest.current=value;setStatus(value);setError('');}
      catch(error){if(stopped)return;latest.current={...latest.current,quality:'DISCONNECTED',dataQuality:'DISCONNECTED',realtimeReady:false,label:'设备连接状态暂时无法读取'};setStatus(latest.current);setError('设备连接状态暂时无法读取，请重新检测。');}
      finally{if(!stopped)timer=setTimeout(poll,500);}
    };refresh.current=async(reconnect=false)=>{const value=await api('/communication/redetect',{method:'POST',body:JSON.stringify({reconnect})});if(!stopped){latest.current=value;setStatus(value);setError('');}};void poll();
    return()=>{stopped=true;clearTimeout(timer);controller?.abort();};
  },[api]);
  return {status,error,latest,redetect:()=>refresh.current?.(),reconnect:()=>refresh.current?.(true)};
}

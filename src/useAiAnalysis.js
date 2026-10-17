import { useEffect,useRef,useState } from 'react';

export function useAiAnalysis(api) {
 const [status,setStatus]=useState({batchSize:20,current:null,latest:null}),[notices,setNotices]=useState([]),[error,setError]=useState('');
 const initialized=useRef(false),readyIds=useRef(new Set()),apiRef=useRef(api);apiRef.current=api;
 const generation=useRef(0);
 const refreshRef=useRef(null);
 refreshRef.current??=async()=>{
  const request=++generation.current;
  try{
   const next=await apiRef.current('/ai-analysis/status');
   if(request!==generation.current||!next||next.batchSize!==20)return;
   const ready=next.ready||(next.latest?.analysisStatus==='READY'?[next.latest]:[]);
   const newReady=ready.filter(row=>!readyIds.current.has(row.analysisId));
   if(initialized.current&&newReady.length)setNotices(previous=>[...previous,...newReady.reverse()]);
   ready.forEach(row=>readyIds.current.add(row.analysisId));initialized.current=true;setStatus(next);setError('');
  }catch(failure){if(request===generation.current)setError(failure.message||'AI分析状态读取失败');}
 };
 const refresh=refreshRef.current;
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{clearInterval(timer);generation.current++;};},[refresh]);
 return {status,error,notice:notices[0]||null,clearNotice:()=>setNotices(previous=>previous.slice(1)),refresh};
}

export function useRetentionLease(api,{logIds=[],analysisIds=[],type='ANALYSIS',enabled=true}) {
 const signature=JSON.stringify({logIds,analysisIds,type,enabled}),apiRef=useRef(api);apiRef.current=api;
 useEffect(()=>{
  if(!enabled||!logIds.length&&!analysisIds.length)return;
  let stopped=false,id=null;
  const pin=async()=>{
   try{const previous=id,held=await apiRef.current('/logs/retention-lease',{method:'POST',body:JSON.stringify({type,logIds,analysisIds})});
    if(stopped){await apiRef.current('/logs/retention-lease',{method:'POST',body:JSON.stringify({release:true,leaseId:held.leaseId})});return;}
    id=held.leaseId;if(previous)void apiRef.current('/logs/retention-lease',{method:'POST',body:JSON.stringify({release:true,leaseId:previous})}).catch(()=>{});
   }catch{}
  };
  void pin();const timer=setInterval(()=>void pin(),30000);
  return()=>{stopped=true;clearInterval(timer);if(id)void apiRef.current('/logs/retention-lease',{method:'POST',body:JSON.stringify({release:true,leaseId:id})}).catch(()=>{});};
 },[signature]);
}

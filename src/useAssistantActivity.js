import { useEffect, useRef, useState } from 'react';
import { createUiTask, restoreTaskActivities, settleUiTask } from './assistantTaskRuntime.js';

export function useAssistantActivity(owner) {
  const storageKey='qcdkr.assistant-tasks.v1:'+encodeURIComponent(owner),[history,setHistory]=useState(()=>{try{return restoreTaskActivities(localStorage.getItem(storageKey));}catch{return [];}});
  const [activeId,setActiveId]=useState(null),[storageError,setStorageError]=useState(''),activeRef=useRef(null),controller=useRef(null);
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify({version:1,tasks:history}));setStorageError('');}catch{setStorageError('任务记录未写入本机存储；本次界面结果仍保留。');}},[history,storageKey]);
  useEffect(()=>()=>controller.current?.value.abort(new DOMException('窗口已关闭','AbortError')),[]);
  const begin=(experience,action,messages)=>{
    const task=createUiTask(experience,action,messages);controller.current={id:task.task_id,value:new AbortController()};activeRef.current=task;setActiveId(task.task_id);setHistory(items=>[...items,task]);return task.task_id;
  };
  const finish=(id,receipt)=>{if(controller.current?.id===id)controller.current=null;if(activeRef.current?.task_id===id)activeRef.current=settleUiTask(activeRef.current,receipt);setHistory(items=>items.map(t=>t.task_id===id?settleUiTask(t,receipt):t));};
  const cancel=()=>controller.current?.value.abort(new DOMException('用户已停止任务','AbortError'));
  const signal=id=>controller.current?.id===id?controller.current.value.signal:undefined;
  return {cancel,signal,history,active:history.find(t=>t.task_id===activeId)||null,activeRef,storageError,begin,finish};
}

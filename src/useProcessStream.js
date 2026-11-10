import { useEffect, useRef, useState } from 'react';
import { createDemoFrame, createManualFrame, parseTelemetryCSV, framesToCSV, timeseriesTemplateCSV } from './telemetry.js';
import { resultSampleMetadata } from './predictionSnapshot.js';

// The demo tail has no source timestamps. Keep the original 1.0 s cadence so
// the live panels stay fluid; the readouts are tweened instead of held for a
// long static interval.
const DEMO_SAMPLE_GAP_MS = 1000;

export function useProcessStream(initialInput, onFrame, onPause, onResume) {
  const base = useRef(structuredClone(initialInput));
  const start = useRef(Date.now() - 59000);
  const callback = useRef(onFrame); callback.current = onFrame;
  const pauseCallback = useRef(onPause); pauseCallback.current = onPause;
  const resumeCallback = useRef(onResume); resumeCallback.current = onResume;
  const [mode, setMode] = useState('manual');
  const [running, setRunning] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [rate, updateRate] = useState(1);
  const [frames, setFrames] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [revealedCursor,setRevealedCursor]=useState(0);
  const revealed=useRef(0);
  const [sourceName, setSourceName] = useState('单工况');
  const index = useRef(60);
  const controlRevision = useRef(0);
  const latest = useRef({frames,cursor,mode,running}); latest.current = {frames,cursor,mode,running};
  const publish = (frame, options) => { if (frame) { setWaiting(true); callback.current?.(frame,options); } };
  const looping = mode === 'import' && frames.length > 1 && frames.every(frame => frame.seededDemo === true && frame.historicalReplay === true);


  useEffect(() => {
    if (!running || waiting || mode === 'manual') return;
    const nextFrame = frames[cursor + 1];
    if (!nextFrame && mode === 'import' && !looping) {
      latest.current.running = false;
      setRunning(false);
      return;
    }
    // Seeking resumes existing samples first; only the demo tail generates data.
    // CSV pacing follows sample timestamps, including uneven gaps.
    const sampleGap = nextFrame ? nextFrame.time - frames[cursor].time : DEMO_SAMPLE_GAP_MS;
    let remaining = sampleGap / rate;
    let timer;
    let canceled = false;
    const advance = () => {
      const state = latest.current;
      if (canceled || !state.running || state.mode !== mode) return;
      // Replay the same validated industrial rows; never append generated rows
      // or treat the last-to-first transition as a negative timestamp gap.
      const nextCursor = looping ? (state.cursor + 1) % state.frames.length : state.cursor + 1;
      if (nextCursor < state.frames.length) {
        latest.current.cursor = nextCursor;
        setCursor(nextCursor);
        revealed.current=Math.max(revealed.current,nextCursor);setRevealedCursor(revealed.current);
        publish(state.frames[nextCursor]);
        if (mode === 'import' && !looping && nextCursor === state.frames.length - 1) {
          latest.current.running = false;
          setRunning(false);
        }
      } else if (mode === 'demo') {
        const frame = createDemoFrame(base.current, index.current++, start.current, { calculate: false });
        const next = [...state.frames, frame].slice(-600);
        latest.current = {...state, frames:next, cursor:next.length-1};
        setFrames(next); setCursor(next.length-1); publish(frame);
      }
    };
    // Browsers truncate larger timeouts; long CSV gaps are waited in chunks.
    const schedule = () => {
      const delay = Math.min(remaining, 2147483647);
      timer = setTimeout(() => {
        remaining -= delay;
        if (remaining > 0 && !canceled) schedule();
        else advance();
      }, delay);
    };
    schedule();
    return () => { canceled = true; clearTimeout(timer); };
  }, [mode, running, waiting, rate, frames, cursor, looping]);

  const pause = ({ temporary = false, preserveProjection = true } = {}) => {
    if(!temporary)controlRevision.current+=1;
    const state=latest.current;
    const accepted=state.running&&preserveProjection ? pauseCallback.current?.() : null;
    const position=accepted ? state.frames.findIndex(frame=>frame.time===accepted.time&&frame.input===accepted.input) : -1;
    latest.current={...state,running:false,...(position>=0?{cursor:position}:{})};
    setRunning(false);setWaiting(false);
    if(accepted&&position>=0)setCursor(position);
  };
  const manual = () => {
    pause({preserveProjection:false}); setWaiting(false); setReviewing(false);
    if (latest.current.mode !== 'manual') {
      // Imported timestamps can lie in the future or far in the past. A manual
      // editing session therefore starts a separate time series.
      latest.current = {frames:[],cursor:0,mode:'manual',running:false};
      setFrames([]); setCursor(0);
    }
    setMode('manual'); setSourceName('手动工况');
  };
  const record = (input, result) => {
    const old = latest.current.mode === 'manual' ? latest.current.frames : [];
    const timestamp = Math.max(Date.now(), (old.at(-1)?.time ?? -Infinity) + 1);
    const frame = createManualFrame(input, timestamp, { calculate: false, result });
    const sample = resultSampleMetadata(frame);
    Object.assign(frame, { observed: sample.observed, observedAvailable: sample.observedAvailable, observedSource: sample.observedSource, originMode: sample.source_type === 'DEMO' ? 'demo' : 'manual' });
    const next = [...old, frame].slice(-600);
    latest.current = {frames:next,cursor:next.length-1,mode:'manual',running:false};
    setFrames(next); setCursor(next.length-1); setMode('manual'); setRunning(false); setReviewing(false); setSourceName(sample.source_type === 'HYPOTHETICAL_DRAFT' ? '工况草案' : sample.source_type === 'PUBLIC_DATA' ? input.importProvenance?.sourceName || '公开 CRD 数据样本' : '手动工况');
    // App owns the edited input. Publishing a clone here would retrigger its
    // manual prediction effect and create an endless recording loop.
    return frame;
  };
  const complete = (frame, result) => {
    const state = latest.current;
    const next = state.frames.map(item => item.time === frame.time && item.input === frame.input ? { ...item, result: structuredClone(result), predicted: result.value } : item);
    latest.current = { ...state, frames: next };
    setFrames(next); setWaiting(false);
  };
  const fail = () => { pause({preserveProjection:false}); setWaiting(false); };
  const demo = input => {
    controlRevision.current+=1;
    base.current = structuredClone(input); start.current = Date.now()-59000; index.current = 60;
    const next = Array.from({length:60}, (_,i)=>createDemoFrame(base.current,i,start.current,{ calculate: false }));
    latest.current = {frames:next,cursor:59,mode:'demo',running:true};
    setFrames(next); setCursor(59); setMode('demo'); setSourceName('演示数据'); setRunning(true); setReviewing(false); publish(next[59],{resetProjection:true});
  };
  const loadCSV = (text, name, input, importOptions = {}) => {
    const next = parseTelemetryCSV(text,input,{ ...importOptions, calculate: false });
    // Identity assignment and all state writes happen only after every row passes.
    const datasetId=globalThis.crypto.randomUUID();
    next.forEach((frame,index)=>{
      const frameId=datasetId+':'+(index+1);
      frame.dataset_id=datasetId;frame.dataset_version=datasetId;frame.frame_identity=frameId;
      frame.input.importProvenance={source_type:'CSV_REPLAY',sourceName:name,stream_id:datasetId,sample_id:frameId,frame_identity:frameId,
        input_version:0,sample_timestamp:frame.timestamp,observed:frame.observed,observedAvailable:frame.observedAvailable,observedSource:frame.observedSource,
        ...(frame.importUnitDecision?{importUnitDecision:frame.importUnitDecision}:{})};
    });
    controlRevision.current+=1;
    revealed.current=0;setRevealedCursor(0);
    latest.current={frames:next,cursor:0,mode:'import',running:false};
    setFrames(next);setCursor(0);setMode('import');setSourceName(name);setRunning(false);setReviewing(false);publish(next[0],{resetProjection:true,datasetReplaced:true});
  };
  const loadFrames = (rows, name='样本片段', selected=0) => {
    if(!Array.isArray(rows)||!rows.length)throw new Error('没有可回放的样本。');
    const next=rows.map((row,index)=>{
      const input=structuredClone(row.input||row.caseData||row),source=row.input||row.caseData?row:{};
      input.target=null;
      const recordedTime=Number.isFinite(source.time)?source.time:Date.parse(source.timestamp);
      const timestampAvailable=source.timestampAvailable!==false&&input.importProvenance?.timestampAvailable!==false&&Number.isFinite(recordedTime);
      return {...source,input,time:Number.isFinite(recordedTime)?recordedTime:index*1000,timestampAvailable,sequence:source.sequence??index+1,predicted:Number.isFinite(source.predicted)?source.predicted:source.result?.value??null};
    });
    const position=Math.max(0,Math.min(next.length-1,Math.trunc(selected)||0));
    revealed.current=position;setRevealedCursor(position);
    controlRevision.current+=1;
    latest.current={frames:next,cursor:position,mode:'import',running:false};
    setFrames(next);setCursor(position);setMode('import');setSourceName(name);setRunning(false);setReviewing(true);publish(next[position],{resetProjection:true});
  };
  const realtime = frame => {
    const state=latest.current,old=state.mode==='plc'?state.frames:[],next=[...old,frame].slice(-600);
    if(state.mode!=='plc')controlRevision.current+=1;
    latest.current={frames:next,cursor:next.length-1,mode:'plc',running:false};
    setFrames(next);setCursor(next.length-1);setMode('plc');setRunning(false);setReviewing(false);setSourceName(frame.input.importProvenance.sourceName||'现场PLC');publish(frame,{resetProjection:state.mode!=='plc'});
  };
  const seek = value => {
    const state = latest.current;
    if (!Number.isFinite(value) || !state.frames.length) return;
    const position = Math.max(0,Math.min(state.frames[0]?.seededDemo?revealed.current:state.frames.length-1,Math.round(value)));
    pause({preserveProjection:false});setReviewing(true);setCursor(position);latest.current.cursor=position;publish(state.frames[position],{resetProjection:true});
  };
  const toggle = () => {
    controlRevision.current+=1;
    const state=latest.current;
    if (state.mode==='manual' || state.mode==='plc' || !state.frames.length) return;
    if (state.running) { pause(); return; }
    if (state.mode==='import' && state.frames.length===1) return;
    if (state.mode==='import' && state.cursor===state.frames.length-1) {
      setCursor(0);latest.current.cursor=0;publish(state.frames[0]);
    }
    resumeCallback.current?.();latest.current.running=true;setRunning(true);setReviewing(false);
  };
  const setRate = value => { if (Number.isFinite(value) && value>0) updateRate(value); };
  const download = (template=false) => {
    if (!template && !latest.current.frames.length) return;
    const csv=template?timeseriesTemplateCSV():framesToCSV(latest.current.frames);
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=template?'QCDKR_时序模板.csv':'QCDKR_时序记录.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  };
  return {get controlVersion(){return controlRevision.current;},mode,running,reviewing,rate,setRate,frames,cursor,revealedCursor,sourceName,pause,manual,record,complete,fail,demo,loadCSV,loadFrames,realtime,seek,toggle,download,frame:frames[cursor]};
}

import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import ProcessMatrix from './ProcessMatrix.jsx';
import {updateStandField} from './processState.js';
import {reportInputFingerprint} from './predictionSnapshot.js';
import {summarizeModelInputs} from './modelInputs.js';
import {processDisplayFieldIssues} from './caseImportBoundary.js';

/** Local edits are never a formal input. Only Apply crosses the commit boundary. */
export default function CommittedParameterEditor({caseData,onApply,onEditDirty,onBeginEdit,discardTimeseriesCount=0,...props}){
  const [draft,setDraft]=useState(()=>structuredClone(caseData));
  const [confirmingTimeseriesReset,setConfirmingTimeseriesReset]=useState(false);
  const changed=reportInputFingerprint(draft)!==reportInputFingerprint(caseData);
  const processIssues=processDisplayFieldIssues(draft);
  const valid=summarizeModelInputs(draft).valid&&!processIssues.length;
  // 2026-11-18：只在工况本身变化、且本地没有未应用修改时同步草稿。
  // 原来每次 caseData 换对象（回放每帧、父级轮询）都 structuredClone 一次，
  // 输入框会被重置/重复重渲染，看起来像跳帧闪烁，正在输入的内容也会被冲掉。
  const draftRef=useRef(draft);draftRef.current=draft;
  const syncedRef=useRef(reportInputFingerprint(caseData));
  useEffect(()=>{
    const next=reportInputFingerprint(caseData);
    if(next===syncedRef.current)return;
    if(reportInputFingerprint(draftRef.current)!==syncedRef.current)return;
    syncedRef.current=next;
    setDraft(structuredClone(caseData));
  },[caseData]);
  const onFieldChange=useCallback((stand,field,value)=>setDraft(previous=>updateStandField(previous,stand,field,value)),[]);
  const onCaseFieldChange=useCallback((field,value)=>setDraft(previous=>({...previous,[field]:value})),[]);
  useEffect(()=>{onEditDirty?.(changed);},[changed]);
  useEffect(()=>{onBeginEdit?.();return()=>onEditDirty?.(false);},[]);
  useEffect(()=>{if(!changed)setConfirmingTimeseriesReset(false);},[changed]);
  const applyDraft=()=>{
    const input=structuredClone(draft),s5=input.stands.find(stand=>stand.id==='S5');
    for(const field of ['force','frontTension'])if(s5[field]==null||s5[field]==='')s5[field]=null;
    if(onApply?.(input)!==false){setDraft(input);onEditDirty?.(false);}
  };
  const requestApply=()=>{
    if(discardTimeseriesCount>1){setConfirmingTimeseriesReset(true);return;}
    applyDraft();
  };
  return <>
    <ProcessMatrix {...props} caseData={draft} dirty={changed} errors={[...(props.errors||[]),...processIssues.map(issue=>issue.message)]}
      onFieldChange={onFieldChange}
      onCaseFieldChange={onCaseFieldChange}/>
    <div className="parameter-commit-actions">
      <span>{changed?'修改尚未应用':'编辑后点击应用，自动预测当前工况'}</span>
      <button type="button" className="button secondary" disabled={!changed} onClick={()=>setDraft(structuredClone(caseData))}>取消修改</button>
      <button type="button" className="button primary" disabled={!changed||!valid} onClick={requestApply}>应用参数</button>
    </div>
    {confirmingTimeseriesReset&&createPortal(<div className="parameter-apply-confirm-layer" role="presentation">
      <section className="parameter-apply-confirm" role="alertdialog" aria-modal="true" aria-labelledby="timeseries-reset-title" aria-describedby="timeseries-reset-detail" onKeyDown={event=>{if(event.key==='Escape')setConfirmingTimeseriesReset(false);}}>
        <h3 id="timeseries-reset-title">切换为手动单工况？</h3>
        <p id="timeseries-reset-detail">当前已载入 <b>{discardTimeseriesCount}</b> 条工业数据回放记录。应用参数后，工作台会切换到手动单工况并重新计算，回放记录将退出当前工作台；已保存工况与已导出的文件不受影响。</p>
        <div><button type="button" className="button secondary" autoFocus onClick={()=>setConfirmingTimeseriesReset(false)}>取消</button><button type="button" className="button primary" onClick={()=>{setConfirmingTimeseriesReset(false);applyDraft();}}>继续应用</button></div>
      </section>
    </div>,document.body)}
  </>;
}

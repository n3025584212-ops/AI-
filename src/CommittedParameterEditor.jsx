import {useEffect,useState} from 'react';
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
  useEffect(()=>{setDraft(structuredClone(caseData));},[caseData]);
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
      onFieldChange={(stand,field,value)=>setDraft(previous=>updateStandField(previous,stand,field,value))}
      onCaseFieldChange={(field,value)=>setDraft(previous=>({...previous,[field]:value}))}/>
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

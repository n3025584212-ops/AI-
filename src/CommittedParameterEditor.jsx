import {useEffect,useState} from 'react';
import ProcessMatrix from './ProcessMatrix.jsx';
import {updateStandField} from './processState.js';
import {reportInputFingerprint} from './predictionSnapshot.js';
import {summarizeModelInputs} from './modelInputs.js';
import {processDisplayFieldIssues} from './caseImportBoundary.js';

/** Local edits are never a formal input. Only Apply crosses the commit boundary. */
export default function CommittedParameterEditor({caseData,onApply,onEditDirty,onBeginEdit,...props}){
  const [draft,setDraft]=useState(()=>structuredClone(caseData));
  const changed=reportInputFingerprint(draft)!==reportInputFingerprint(caseData);
  const processIssues=processDisplayFieldIssues(draft);
  const valid=summarizeModelInputs(draft).valid&&!processIssues.length;
  useEffect(()=>{setDraft(structuredClone(caseData));},[caseData]);
  useEffect(()=>{onEditDirty?.(changed);},[changed]);
  useEffect(()=>{onBeginEdit?.();return()=>onEditDirty?.(false);},[]);
  return <>
    <ProcessMatrix {...props} caseData={draft} dirty={changed} errors={[...(props.errors||[]),...processIssues.map(issue=>issue.message)]}
      onFieldChange={(stand,field,value)=>setDraft(previous=>updateStandField(previous,stand,field,value))}
      onCaseFieldChange={(field,value)=>setDraft(previous=>({...previous,[field]:value}))}/>
    <div className="parameter-commit-actions">
      <span>{changed?'修改尚未应用':'编辑后点击应用，自动预测当前工况'}</span>
      <button type="button" className="button secondary" disabled={!changed} onClick={()=>setDraft(structuredClone(caseData))}>取消修改</button>
      <button type="button" className="button primary" disabled={!changed||!valid} onClick={()=>{const input=structuredClone(draft),s5=input.stands.find(stand=>stand.id==='S5');for(const field of ['force','frontTension'])if(s5[field]==null||s5[field]==='')s5[field]=null;if(onApply?.(input)!==false){setDraft(input);onEditDirty?.(false);}}}>应用参数</button>
    </div>
  </>;
}

import { retrieveKnowledge, selectKnowledgePassages, synthesizeKnowledgeAnswer } from './knowledge.mjs';
import { toDisplay, unitFor, sourceUnitFor } from '../src/engineeringUnits.js';
import { QUESTION_TYPE } from '../src/questionType.js';

const zero = () => ({tool_router:0,relevance_classifier:0,answer_attempt:0,answer_success:0,total:0});
function exposesKnowledgeInternals(text,features,passages){
  return /本地资料命中|正式键名|canonical|grounding|^\s*#{1,6}\s|\bL\d+(?:\s*[-–—]\s*L?\d+)?\b|\.(?:md|docx|mjs|json|pkl)\b/im.test(text)
    || features.some(feature=>text.includes(feature.key))
    || passages.some(passage=>['fileName','locator','documentId','chunkId'].some(key=>passage[key]&&text.includes(passage[key]))
      || passage.title&&text.includes('《'+passage.title+'》')
      || passage.text.trim().length>80&&text.includes(passage.text.trim()));
}
// Knowledge needs a shared concept, not a selected current-value instance.
// Use only the choices already produced by the frozen canonical resolver.
function knowledgeSubject(resolution,query){
  if(resolution.status==='RESOLVED')return {name:resolution.parameter.label,features:[resolution.parameter],stand:resolution.parameter.stand,scope:'INSTANCE'};
  const groups=new Map(),text=String(query || '').normalize('NFKC').replace(/\s/g,'').toLowerCase();
  for(const feature of resolution.choices){
    const name=feature.label.replace(/^S[1-5]\s*/,'');
    if(!text.includes(name.replace(/\s/g,'').toLowerCase()))continue;
    const key=feature.field+'|'+name;
    if(!groups.has(key))groups.set(key,{name,features:[],stand:null,scope:'FAMILY'});
    groups.get(key).features.push(feature);
  }
  return groups.size===1?[...groups.values()][0]:null;
}
export async function answerParameterQuestion({classification,context,knowledge,llm,signal,isCurrent,query='',detail=false,sourceQuery=query}) {
  const {question_type:type,resolution}=classification;
  if(!classification.enabled)return {status:'completed',responseType:classification.status,text:'已识别 '+type+'，本批尚未启用该问法类型。',llmCalls:zero(),references:[]};
  const subject=type===QUESTION_TYPE.PARAMETER_KNOWLEDGE?knowledgeSubject(resolution,sourceQuery):null;
  if(resolution.status!=='RESOLVED'&&!subject)return {status:'needs_input',parameter_resolution:resolution.status,text:resolution.status==='AMBIGUOUS'
    ?'参数名称有歧义，请明确：'+resolution.choices.map(feature=>feature.label).join('、')+'。':'请指定一个已注册的正式模型输入参数。',llmCalls:zero(),references:[]};
  const feature=resolution.parameter;
  if(type===QUESTION_TYPE.PARAMETER_CURRENT_VALUE){
    const snapshot=context.input_snapshot,value=snapshot?.canonical_25?.[feature.key];
    if(!snapshot||context.prediction?.mode!=='formal'||context.prediction.snapshot_id!==snapshot.snapshot_id||!isCurrent()||!Number.isFinite(value))
      return {status:'completed',responseType:'CURRENT_VALUE_UNAVAILABLE',text:'CURRENT_VALUE_UNAVAILABLE：当前有效快照的参数值不可用，请先完成当前工况正式预测。',llmCalls:zero(),references:[]};
    const displayed=toDisplay(feature.field,value),unit=unitFor(feature.field);
    return {status:'completed',text:feature.label+'：'+String(displayed)+' '+unit+'。基于当前已核验工况快照。',
      parameter_fact:{parameter_id:feature.key,name:feature.label,stand:feature.stand,value:displayed,unit,raw_value:value,raw_unit:sourceUnitFor(feature.field),snapshot_id:snapshot.snapshot_id},llmCalls:zero(),references:[]};
  }
  const docs=await knowledge(),concept=subject.name.replace(/^S[1-5]\s*/,''),passages=[];
  const technical=/模型输入|输入字段|字段(?:定义|编号|说明)|数据(?:结构|契约|合同)|canonical|parameter_id/i.test(sourceQuery);
  const sourceDocs=technical?docs:docs.filter(doc=>doc.kind==='general'||doc.kind==='user');
  // The equipment terminology section names the mechanism "弯辊".
  const passageConcept=concept==='弯辊力'?'弯辊':concept;
  for(const name of technical?[subject.name,concept]:[concept,concept]){
    const remainingDocs=passages.length?sourceDocs.filter(doc=>!passages.some(passage=>passage.documentId===doc.id)):sourceDocs;
    const references=retrieveKnowledge(remainingDocs,'什么是'+name+'？',{limit:6});
    const selected=selectKnowledgePassages(remainingDocs,references,{targetConcept:technical?name:passageConcept,detail,stands:technical&&subject.stand?[subject.stand]:null});
    // A detailed followup cannot expand a retrieval fallback for an unrelated
    // chapter merely because it mentions this parameter in passing.
    const scoped=detail&&!technical?selected.filter(passage=>passage.sectionHeading || passage.title.includes(passageConcept)):selected;
    const substantive=detail&&scoped.some(passage=>passage.sectionHeading!=='概述')?scoped.filter(passage=>passage.sectionHeading!=='概述'):scoped;
    for(const passage of substantive.slice(0,detail?2:1)){
      // Select definitions and roles; policy/provenance sentences stay in the
      // unchanged knowledge assets, outside ordinary parameter explanations.
      const text=technical?passage.text:passage.text.split(/(?<=[。！？])\s*|\n+/u)
        .filter(sentence=>! /根因|因果|归因|证据|安全|阈值|不能(?:支持|证明)|不(?:代表|证明)|DOC-\d|source_|evidence_id|Snapshot|Finding|Evidence/.test(sentence)).join('\n').trim();
      if(text&&!passages.some(item=>item.documentId===passage.documentId&&item.chunkId===passage.chunkId&&item.sectionHeading===passage.sectionHeading))passages.push({...passage,text,id:'R'+(passages.length+1)});
      if(passages.length===2)break;
    }
    if(passages.length===2)break;
  }
  const metadata={...(feature?{parameter_id:feature.key}:{}),name:subject.name,unit:unitFor(subject.features[0].field),raw_unit:sourceUnitFor(subject.features[0].field),stand:subject.stand,
    location:subject.stand || (subject.scope==='FAMILY'?'未指定机架，按资料解释工艺位置':'来料 / 工程'),parameter_scope:subject.scope,answer_focus:technical?'MODEL_FIELD_DEFINITION':'PHYSICAL_MEANING'};
  const answer=await synthesizeKnowledgeAnswer({query:detail?'详细解释'+subject.name:query || subject.name+'是什么？',targetConcept:concept,detail,parameterMetadata:metadata,passages,llm,signal});
  const rejected=!answer.generationError&&exposesKnowledgeInternals(answer.text,subject.features,passages);
  const failed=Boolean(answer.generationError)||rejected;
  return {...answer,text:failed?'DK AI参数知识解释当前不可用。':answer.text,
    status:failed?'partial':'completed',references:[],generationError:failed?(rejected?'PARAMETER_KNOWLEDGE_OUTPUT_REJECTED':answer.generationError):null,
    llmCalls:rejected?{...answer.llmCalls,answer_success:0}:answer.llmCalls,
    knowledge_debug:{references:answer.references,generation_error:answer.generationError,rejected_text:rejected?answer.text:null},
    target_concept:subject.name,detail_level:detail?'DETAILED':'SIMPLE',knowledge_source_question:sourceQuery,
    parameter_metadata:metadata,parameter_resolution:subject.scope==='FAMILY'?'PARAMETER_FAMILY':'RESOLVED'};
}

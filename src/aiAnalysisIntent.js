export function aiAnalysisIntent(question, activeAnalysisId=null) {
 const text=String(question||'').trim();
 const localDate=/昨天/.test(text)?'昨天':/今天/.test(text)?'今天':undefined;
 if(/^(返回当前运行|看当前工况|返回当前工况)[。！？!?]*$/.test(text))return {type:'CURRENT'};
 if(/查看\s*AI分析记录|AI分析历史|查看.*分析记录/i.test(text))return {type:'LIST',localDate};
 const id=/打开(?:批次|分析)?\s*#?(A-\d{4,12})/i.exec(text);
 if(id)return {type:'OPEN',analysisId:id[1].toUpperCase()};
 if(/打开上一次AI分析|上一次.*分析记录/.test(text))return {type:'LATEST',localDate};
 if(/(最近|昨天|今天).*哪批.*误差最大/.test(text))return {type:'MAX_ERROR',localDate};
 if(/分析最近\s*20\s*条/.test(text))return {type:'ANALYZE_RECENT'};
 if(/分析(当前记录|该未完成批次|当前批次)/.test(text))return {type:'ANALYZE_PARTIAL',analysisId:/该未完成批次/.test(text)?activeAnalysisId:null};
 if(activeAnalysisId){
  if(/当前工况|当前输入|当前预测|S[1-5].*(设为|调整为|改为)|试算/.test(text))return {type:'CURRENT'};
  if(/批次|这批|该批|报警|异常记录|处理建议|为什么|原因|怎么办|有哪些建议/.test(text))return {type:'FOLLOWUP',analysisId:activeAnalysisId};
  return {type:'CHOOSE',analysisId:activeAnalysisId};
 }
 return null;
}
export function analysisDatasetIdentity(input) {
 const source=input?.importProvenance||{};
 const datasetVersion=source.dataset_version||source.stream_id||source.source_file_sha256||'manual-v1';
 return {datasetId:source.dataset_id||source.source_file||source.file_name||source.sourceName||datasetVersion,datasetVersion,
  spec:source.spec||source.spec_metadata||{entrySetThickness:input?.entrySetThickness,width:input?.width,exitSetThickness:source.exit_set_thickness??null}};
}

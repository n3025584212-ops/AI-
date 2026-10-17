import { MODEL_FEATURES, modelInputFeatures } from '../../src/modelInputs.js';
import { FEATURE_KEYS, validatePredictionInput } from '../prediction-contract.mjs';
import { ENGINEERING_UNIT_SYSTEM, convertUnit, sourceUnitFor } from '../../src/engineeringUnits.js';
import { checkHistoricalRanges } from '../../src/historicalRangeCheck.js';

export class CommunicationError extends Error {
  constructor(code, message, details = {}, status = 400) { super(message); this.code=code; this.details=details; this.status=status; }
}
export const POINT_MAP_COLUMNS=Object.freeze(['canonicalField','plcVariableName','registerAddress','addressNotation','functionCode','dataType','byteOrder','wordOrder','scale','offset','sourceUnit','enabled']);
export const REGISTER_WIDTH=Object.freeze({INT16:1,UINT16:1,FLOAT32:2,INT32:2,UINT32:2});
const fail=(message,details={})=>{throw new CommunicationError('COMM_PROFILE_MISMATCH',message,details);};
const number=value=>typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
export function registerOffset(mapping) {
  const address=number(mapping.registerAddress),fc=number(mapping.functionCode);
  if(!Number.isInteger(address)||![3,4].includes(fc))fail('寄存器地址和只读功能码必须明确。');
  const offset=mapping.addressNotation==='ZERO_BASED'?address
    :mapping.addressNotation==='MODBUS_4XXXX'&&fc===3&&address>=40001&&address<=49999?address-40001:NaN;
  if(!Number.isInteger(offset)||offset<0||offset+(REGISTER_WIDTH[mapping.dataType]||1)>65536)fail('地址表示不兼容：40001地址仅用于功能码03；功能码04请使用零基地址。');
  return offset;
}
export function normalizeMapping(raw,{role='input'}={}) {
  if(!raw||typeof raw!=='object')fail('点表项目格式无效。');
  const enabled=raw.enabled===true||raw.enabled===1||raw.enabled==='true'||raw.enabled==='TRUE'||raw.enabled==='1';
  if(![true,false,1,0,'true','false','TRUE','FALSE','1','0'].includes(raw.enabled))fail('enabled须明确填写true或false。');
  const mapping={...raw,enabled,readWrite:raw.readWrite??'READ_ONLY'};
  if(!['READ_ONLY','READ'].includes(mapping.readWrite))fail('本系统仅支持PLC只读点表。');
  if(!enabled)return mapping;
  if(role==='input'&&!FEATURE_KEYS.includes(mapping.canonicalField))fail('字段不属于正式25项输入。',{field:mapping.canonicalField});
  if(role==='actual'&&mapping.canonicalField!=='actualValue')fail('S5实际值必须单独映射为actualValue。');
  if(role==='sequence'&&!['sequence','frameCounter','cycleId','coilId'].includes(mapping.canonicalField))fail('采样标识字段不受支持。');
  if(typeof mapping.plcVariableName!=='string'||!mapping.plcVariableName.trim())fail('请填写PLC变量名称。');
  if(!REGISTER_WIDTH[mapping.dataType]||!['BIG_ENDIAN','LITTLE_ENDIAN'].includes(mapping.byteOrder)||!['HIGH_FIRST','LOW_FIRST'].includes(mapping.wordOrder))fail('请明确数据类型、字节序和字序。');
  mapping.registerAddress=number(raw.registerAddress);mapping.functionCode=number(raw.functionCode);
  mapping.scale=number(raw.scale);mapping.offset=number(raw.offset);
  if(!Number.isFinite(mapping.scale)||!Number.isFinite(mapping.offset)||mapping.scale===0)fail('比例须为非零有限数值，偏移须为有限数值。');
  registerOffset(mapping);
  const unit=role==='sequence'?null:sourceUnitFor(role==='actual'?'actual':mapping.canonicalField);
  if(unit&&convertUnit(1,mapping.sourceUnit,unit)===null)fail('源单位无法转换到正式工程单位。',{field:mapping.canonicalField,sourceUnit:mapping.sourceUnit,unit});
  if(role==='sequence'&&(!['INT16','UINT16','INT32','UINT32'].includes(mapping.dataType)||mapping.scale!==1||mapping.offset!==0))fail('采样标识须为未经缩放的整数。');
  return mapping;
}
export function validatePointMap(rows) {
  if(!Array.isArray(rows)||rows.length>128)fail('点表须为项目数组，最多128项。');
  const registerMap=[],errors=[],seen=new Set();let actualS5=null;
  for(const [index,raw]of rows.entries())try{
    const role=raw?.canonicalField==='actualValue'?'actual':'input',m=normalizeMapping(raw,{role});
    if(m.enabled&&seen.has(m.canonicalField))fail('同一个输入字段不得重复映射。',{field:m.canonicalField});
    if(m.enabled)seen.add(m.canonicalField);
    if(role==='actual'){if(actualS5)fail('S5实际值不得重复配置。');actualS5=m;}else registerMap.push(m);
  }catch(error){errors.push({row:index+2,field:raw?.canonicalField,message:error.message});}
  const missing=MODEL_FEATURES.filter(f=>!registerMap.some(m=>m.enabled&&m.canonicalField===f.key));
  return {registerMap,actualS5,count:25-missing.length,missing:missing.map(f=>({field:f.key,label:f.label})),errors,valid:!missing.length&&!errors.length};
}
export function buildRegisterBlocks(mappings) {
  const points=mappings.filter(m=>m?.enabled).map(m=>({mapping:m,start:registerOffset(m),end:registerOffset(m)+REGISTER_WIDTH[m.dataType]})).sort((a,b)=>a.mapping.functionCode-b.mapping.functionCode||a.start-b.start);
  const blocks=[];
  for(const point of points){const last=blocks.at(-1);if(last&&last.functionCode===point.mapping.functionCode&&point.start<=last.end&&Math.max(last.end,point.end)-last.start<=125){last.end=Math.max(last.end,point.end);last.points.push(point);}else blocks.push({functionCode:point.mapping.functionCode,start:point.start,end:point.end,points:[point]});}
  return blocks.map(b=>({...b,count:b.end-b.start}));
}
export function decodeRegisters(bytes,mapping) {
  const size=REGISTER_WIDTH[mapping.dataType]*2;
  if(!Buffer.isBuffer(bytes)||bytes.length!==size)throw new CommunicationError('COMM_REGISTER_DECODE_ERROR','寄存器长度与数据类型不一致。');
  let words=Array.from({length:size/2},(_,i)=>Buffer.from(bytes.subarray(i*2,i*2+2)));
  if(mapping.byteOrder==='LITTLE_ENDIAN')words=words.map(w=>Buffer.from([w[1],w[0]]));
  if(mapping.wordOrder==='LOW_FIRST')words.reverse();
  const b=Buffer.concat(words),read={INT16:'readInt16BE',UINT16:'readUInt16BE',FLOAT32:'readFloatBE',INT32:'readInt32BE',UINT32:'readUInt32BE'}[mapping.dataType];
  const value=b[read](0)*mapping.scale+mapping.offset;
  if(!Number.isFinite(value))throw new CommunicationError('COMM_REGISTER_DECODE_ERROR','PLC数值解码后不是有限数值。',{field:mapping.canonicalField});
  return value;
}
export function canonicalCase(values,{profile,frameId,timestamp,actualValue=null,target=null}={}) {
  const input={id:frameId,grade:'',width:null,entrySetThickness:null,target,unitSystem:ENGINEERING_UNIT_SYSTEM,stands:Array.from({length:5},(_,i)=>({id:`S${i+1}`}))};
  for(const feature of MODEL_FEATURES){const owner=feature.stand?input.stands.find(s=>s.id===feature.stand):input;owner[feature.field]=values[feature.key];}
  input.importProvenance={source_type:'PLC_REALTIME',transport:'MODBUS_TCP',sourceName:profile?.profileName||'现场PLC',sample_id:frameId,stream_id:profile?.profileId||'plc',input_version:profile?.profileVersion||1,sample_timestamp:timestamp,observed:actualValue,observedAvailable:Number.isFinite(actualValue),observedSource:Number.isFinite(actualValue)?'现场PLC S5实际轧制力':'未提供S5实际值'};
  return input;
}
export function validateRealtimeFrame(values,table,limits={},sample={}) {
  const input=canonicalCase(values),contract=validatePredictionInput(modelInputFeatures(input));
  // Receiving register bytes and accepting their decoded value are different facts.
  const readFields=new Set(sample.readFields??MODEL_FEATURES.filter(f=>Object.hasOwn(values,f.key)).map(f=>f.key));
  const missing=MODEL_FEATURES.filter(f=>!readFields.has(f.key)).map(f=>({field:f.key,label:f.label}));
  const ranges=checkHistoricalRanges(input,table,limits),invalid=ranges.rows.filter(r=>r.isModelInput&&!Number.isFinite(r.value));
  const readCount=25-missing.length,validCount=MODEL_FEATURES.filter(f=>readFields.has(f.key)&&Number.isFinite(values[f.key])).length;
  return {valid:readCount===25&&validCount===25&&contract.status==='VERIFIED',count:readCount,readCount,validCount,missing,issues:invalid.map(r=>({field:r.key,label:r.label,unit:r.unit||sourceUnitFor(r.key),value:Number.isFinite(r.value)?r.value:null,min:r.min??null,max:r.max??null,status:r.status,message:sample.decodeErrors?.find(e=>e.field===r.key)?.message??null}))};
}

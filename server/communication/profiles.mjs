import { mkdir,readFile,writeFile,rename,readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isIPv4 } from 'node:net';
import readXlsxFile from 'read-excel-file/node';
import JSZip from 'jszip';
import { POINT_MAP_COLUMNS,CommunicationError,validatePointMap,normalizeMapping } from './mapping.mjs';

export const PROFILE_SCHEMA='dkqkar-plc-profile-v1';
export function privateIPv4(ip){if(!isIPv4(ip))return false;const [a,b]=ip.split('.').map(Number);return a===10||a===172&&b>=16&&b<=31||a===192&&b===168||a===169&&b===254;}
export function validateProfile(raw) {
  const bad=message=>{throw new CommunicationError('COMM_PROFILE_MISMATCH',message);};
  if(!raw||raw.schemaVersion!==PROFILE_SCHEMA||raw.protocol!=='MODBUS_TCP')bad('设备配置版本或通讯方式不受支持。');
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(raw.profileId)||['CON','PRN','AUX','NUL','COM1','LPT1'].includes(raw.profileId.toUpperCase()))bad('设备配置编号无效。');
  if(typeof raw.profileName!=='string'||!raw.profileName.trim()||raw.profileName.length>100)bad('请填写设备名称。');
  if(!Number.isInteger(raw.profileVersion)||raw.profileVersion<1)bad('设备配置版本无效。');
  const network=raw.network||{},plc=raw.plc||{};
  if(!network.localInterfaceGuid||typeof network.localInterfaceName!=='string'||!network.localInterfaceName.trim()||!/^(?:[0-9a-f]{12}|(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})$/i.test(network.localInterfaceMac||''))bad('请确认工业网卡身份。');
  if(!privateIPv4(network.localInterfaceIPv4)||!privateIPv4(plc.host))bad('工业通讯须使用明确的工业内网IPv4地址。');
  const port=plc.port??502;if(!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(plc.unitId)||plc.unitId<0||plc.unitId>255)bad('端口或设备编号无效。');
  const communication={pollIntervalMs:1000,timeoutMs:3000,reconnectIntervalMs:5000,...raw.communication};
  for(const [key,min,max]of [['pollIntervalMs',100,60000],['timeoutMs',100,60000],['reconnectIntervalMs',1000,60000]])if(!Number.isInteger(communication[key])||communication[key]<min||communication[key]>max)bad('通讯周期或超时设置无效。');
  const check=validatePointMap(raw.registerMap);
  if(!check.valid)throw new CommunicationError('COMM_PROFILE_MISMATCH','25项输入点表尚未完整确认。',check);
  if(check.actualS5)bad('S5实际值须与25项输入点表分开保存。');
  const actualS5=raw.actualS5?normalizeMapping(raw.actualS5,{role:'actual'}):null;
  const sequence=raw.sequence?normalizeMapping(raw.sequence,{role:'sequence'}):null;
  return {...raw,network:{...network},plc:{...plc,port},communication,registerMap:check.registerMap,actualS5,sequence};
}
async function atomic(filename,data){const temporary=filename+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(temporary,filename);}
export async function createProfileStore(dataDir) {
  const root=path.join(dataDir,'communication'),profiles=path.join(root,'profiles'),templates=path.join(root,'templates');
  await mkdir(profiles,{recursive:true});await mkdir(templates,{recursive:true});
  let serial=Promise.resolve();const mutate=fn=>{const promise=serial.then(fn);serial=promise.catch(()=>{});return promise;};
  const filename=id=>{if(!/^[A-Za-z0-9_-]{1,80}$/.test(id||''))throw new CommunicationError('COMM_PROFILE_MISMATCH','设备配置编号无效。');return path.join(profiles,id+'.json');};
  const read=async id=>validateProfile(JSON.parse(await readFile(filename(id),'utf8')));
  return {root,templates,read,
    async active(){let active;try{active=JSON.parse(await readFile(path.join(root,'active-profile.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw new CommunicationError('COMM_PROFILE_MISMATCH','当前设备配置无法读取，请维护人员检查配置文件。');}try{return await read(active.activeProfileId);}catch{throw new CommunicationError('COMM_PROFILE_MISMATCH','当前设备配置缺失或不完整，请重新选择已确认的设备配置。');}},
    async list(){const rows=[];for(const name of await readdir(profiles)){if(!name.endsWith('.json'))continue;try{const p=await read(name.slice(0,-5));rows.push({profileId:p.profileId,profileName:p.profileName,profileVersion:p.profileVersion});}catch{}}return rows;},
    save(raw,{activate=false}={}){return mutate(async()=>{const p=validateProfile(raw);let previous=null;try{previous=await read(p.profileId);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(previous&&previous.profileVersion!==p.profileVersion)throw new CommunicationError('COMM_PROFILE_MISMATCH','设备配置已变化，请重新载入后保存。',{},409);
      const saved={...p,profileVersion:previous?previous.profileVersion+1:p.profileVersion};await atomic(filename(p.profileId),saved);
      if(activate)await atomic(path.join(root,'active-profile.json'),{activeProfileId:p.profileId});return saved;});},
    activate(id){return mutate(async()=>{const p=await read(id);await atomic(path.join(root,'active-profile.json'),{activeProfileId:id});return p;});},
    rebind(id,nic,expectedVersion){return mutate(async()=>{const p=await read(id);
      if(p.profileVersion!==expectedVersion)throw new CommunicationError('COMM_PROFILE_MISMATCH','设备配置已变化，请重新载入。',{},409);
      const normalize=v=>String(v).replace(/[^a-f0-9]/gi,'').toLowerCase();
      if(nic.kind!=='Ethernet'||normalize(nic.mac)!==normalize(p.network.localInterfaceMac)||!nic.ipv4.includes(p.network.localInterfaceIPv4))throw new CommunicationError('COMM_PROFILE_MISMATCH','只能重新绑定MAC和预期IPv4一致的原工业网卡。');
      const updated=validateProfile({...p,profileVersion:p.profileVersion+1,network:{...p.network,localInterfaceGuid:nic.guid,localInterfaceMac:nic.mac,localInterfaceName:nic.name}});
      await atomic(filename(id),updated);return updated;});},
  };
}
export function csvRows(text){
  const rows=[];let row=[],value='',quoted=false,afterQuote=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else {quoted=false;afterQuote=true;}}else value+=c;}
    else if(c===','||c==='\n'||c==='\r'){row.push(value);value='';afterQuote=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push(row);row=[];}}
    else if(c==='"'&&!value&&!afterQuote)quoted=true;else {if(afterQuote)throw new CommunicationError('COMM_PROFILE_MISMATCH','CSV引号后的内容无效。');value+=c;}}
  if(quoted)throw new CommunicationError('COMM_PROFILE_MISMATCH','CSV引号未闭合。');row.push(value);if(row.some(v=>v!==''))rows.push(row);return rows;
}
export async function importPointMap({filename,base64}) {
  if(typeof base64!=='string'||base64.length>2800000)throw new CommunicationError('COMM_PROFILE_MISMATCH','点表文件最多2 MiB。');
  const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>2*1024*1024)throw new CommunicationError('COMM_PROFILE_MISMATCH','点表文件为空或过大。');
  const extension=path.extname(filename||'').toLowerCase();let rows;
  if(extension==='.json'){const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));rows=Array.isArray(value)?value:value.registerMap;
    if(!Array.isArray(rows))throw new CommunicationError('COMM_PROFILE_MISMATCH','JSON点表须为数组或registerMap数组。');
    if(!Array.isArray(value)&&value.actualS5)rows=[...rows,value.actualS5];return validatePointMap(rows);
  }
  let table;
  if(extension==='.xlsx'){
    const zip=await JSZip.loadAsync(bytes);const entries=Object.values(zip.files);if(entries.length>200||entries.reduce((sum,e)=>sum+(e._data?.uncompressedSize||0),0)>16*1024*1024)throw new CommunicationError('COMM_PROFILE_MISMATCH','点表工作簿内容过大。');
    // Standard template uses the first sheet, with literal values only.
    for(const file of entries.filter(e=>/^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))){const xml=await file.async('string');if(/<f(?:\s|>)/.test(xml))throw new CommunicationError('COMM_PROFILE_MISMATCH','点表不能包含公式，请填写已确认的固定数值。');}
    const sheets=await readXlsxFile(bytes);table=sheets[0]?.data;
  }else if(extension==='.csv'){
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}table=csvRows(text.replace(/^\uFEFF/,''));
  }else throw new CommunicationError('COMM_PROFILE_MISMATCH','请选择标准CSV、XLSX或JSON点表。');
  if(!Array.isArray(table)||!table.length||table.length>129)throw new CommunicationError('COMM_PROFILE_MISMATCH','点表行数无效。');
  const headers=table[0].map(v=>String(v??'').trim());
  if(headers.length!==POINT_MAP_COLUMNS.length||new Set(headers).size!==headers.length||POINT_MAP_COLUMNS.some(c=>!headers.includes(c)))throw new CommunicationError('COMM_PROFILE_MISMATCH','点表列名须与标准模板完全一致。');
  rows=table.slice(1).filter(row=>row.some(v=>v!==null&&v!=='')).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]??''])));
  return validatePointMap(rows);
}

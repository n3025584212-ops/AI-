import { readFile,copyFile } from 'node:fs/promises';
import path from 'node:path';
import { CommunicationError } from './mapping.mjs';
import { createProfileStore,importPointMap,validateProfile } from './profiles.mjs';
import { IndustrialCommunication } from './service.mjs';
export async function createIndustrialCommunication({dataDir,rangeTable,log,templateSource,overrides={}}) {
  const store=await createProfileStore(dataDir);
  if(templateSource)try{await copyFile(templateSource,path.join(store.templates,'DKQKAR_PLC_POINT_MAP_TEMPLATE.xlsx'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const service=new IndustrialCommunication({store,rangeTable,log,...overrides});await service.start();
  async function route({pathname,req,res,actor,json,body}){
    if(!pathname.startsWith('/api/communication/'))return false;
    const endpoint=pathname.slice('/api/communication/'.length),get=req.method==='GET';
    if(endpoint==='status'&&get){json(res,200,service.status());return true;}
    if(endpoint==='redetect'&&req.method==='POST'){const input=await body(req);json(res,200,await service.redetect({reconnect:input.reconnect===true}));return true;}
    if(!['LOCAL_ADMIN','admin'].includes(actor?.role))throw new CommunicationError('ADMIN_REQUIRED','连接设置需要维护人员账号。',{},403);
    if(endpoint==='interfaces'&&get){json(res,200,{interfaces:service.monitor.interfaces.filter(n=>n.kind==='Ethernet'),profile:service.profile??null,profiles:await store.list()});return true;}
    if(endpoint==='profile'&&get){json(res,200,{profile:service.profile??null});return true;}
    if(endpoint==='template'&&get){const bytes=await readFile(path.join(store.templates,'DKQKAR_PLC_POINT_MAP_TEMPLATE.xlsx'));res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="QCDKR_PLC_POINT_MAP_TEMPLATE.xlsx"','Cache-Control':'no-store'});res.end(bytes);return true;}
    if(req.method!=='POST')throw new CommunicationError('COMM_PROFILE_MISMATCH','此设备连接操作不可用。',{},404);
    const input=await body(req);
    if(endpoint==='test'){json(res,200,await service.testProfile(input.profile||service.profile));return true;}
    if(endpoint==='point-map/review'){try{json(res,200,await importPointMap(input));}catch(error){if(error instanceof CommunicationError)throw error;throw new CommunicationError('COMM_PROFILE_MISMATCH','点表文件无法解析，请检查文件格式。');}return true;}
    if(endpoint==='profile/review'){json(res,200,{profile:validateProfile(input.profile)});return true;}
    if(endpoint==='profile/save'){const p=await store.save(input.profile,{activate:input.activate===true});if(input.activate===true||service.profile?.profileId===p.profileId)await service.activate(p);json(res,200,{profile:p});return true;}
    if(endpoint==='profile/activate'){const p=await store.activate(input.profileId);await service.activate(p);json(res,200,{profile:p});return true;}
    if(endpoint==='profile/export'){json(res,200,{profile:await store.read(input.profileId)});return true;}
    if(endpoint==='profile/rebind'){const nic=service.monitor.interfaces.find(n=>n.guid===input.nicGuid);if(!nic)throw new CommunicationError('COMM_PROFILE_MISMATCH','未找到要绑定的工业网卡。');const p=await store.rebind(input.profileId,nic,input.profileVersion);if(service.profile?.profileId===p.profileId)await service.activate(p);json(res,200,{profile:p});return true;}
    throw new CommunicationError('COMM_PROFILE_MISMATCH','此设备连接操作不可用。',{},404);
  }
  return {service,store,route,close:()=>service.close()};
}

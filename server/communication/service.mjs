import { createHash,randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { MODEL_FEATURES,modelInputValues } from '../../src/modelInputs.js';
import { convertUnit,sourceUnitFor } from '../../src/engineeringUnits.js';
import { ReadOnlyModbusClient } from './modbus-client.mjs';
import { IndustrialNicMonitor,matchIndustrialInterface } from './nic.mjs';
import { validateProfile } from './profiles.mjs';
import { CommunicationError,buildRegisterBlocks,decodeRegisters,registerOffset,REGISTER_WIDTH,canonicalCase,validateRealtimeFrame,validatePointMap } from './mapping.mjs';
const hash=values=>createHash('sha256').update(JSON.stringify(values)).digest('hex');
export const COMMUNICATION_LABELS=Object.freeze({UNCONFIGURED:'尚未完成设备连接设置',NIC_NOT_FOUND:'未检测到工业网络',LINK_DOWN:'未检测到工业网络',NETWORK_MISMATCH:'工业网卡网络配置不匹配',COMM_BIND_FAILED:'工业网卡绑定失败',CONNECTING:'正在连接现场PLC',WAITING_FOR_PLC:'工业网络已连接，但暂未收到PLC响应',COMM_PORT_UNAVAILABLE:'已找到PLC网络，但通讯端口暂不可用',COMM_MODBUS_ERROR:'已连接到设备，但暂时无法读取PLC数据',COMM_PROFILE_MISMATCH:'当前PLC的数据配置与软件不匹配',COMM_DATA_INCOMPLETE:'PLC已连接，但工况数据不完整',COMM_DATA_INVALID:'PLC已连接，但部分工况数据异常',CONNECTED:'PLC已连接',DISCONNECTED:'PLC连接已中断，正在自动重连'});
export class IndustrialCommunication extends EventEmitter {
  constructor({store,rangeTable,log=async()=>{},monitor=new IndustrialNicMonitor(),clientFactory=options=>new ReadOnlyModbusClient(options),now=()=>Date.now()}) {
    super();Object.assign(this,{store,rangeTable,log,monitor,clientFactory,now});this.state={state:'UNCONFIGURED',quality:'DISCONNECTED',count:0,readCount:0,validCount:0,missing:[],issues:[],updatedAt:null,frame:null};this.generation=0;this.frames=new Map();this.closed=false;
  }
  event(code,message,details={}){this.recentEvents??=new Map();const key=JSON.stringify([code,message,details]),previous=this.recentEvents.get(key);if(previous!=null&&this.now()-previous<60000)return;this.recentEvents.set(key,this.now());while(this.recentEvents.size>128)this.recentEvents.delete(this.recentEvents.keys().next().value);void this.log('communication',/ERROR|INVALID|MISMATCH|TIMEOUT|INCOMPLETE/.test(code)?'warning':'info',message,{eventCode:code,profileId:this.profile?.profileId??null,...details}).catch(()=>{});}
  setState(code,quality,extra={}){const old=this.state;this.state={...old,...extra,state:code,quality};if(code!==old.state)this.event(code==='CONNECTED'?'COMM_CONNECTED':code.startsWith('COMM_')?code:'COMM_'+code,COMMUNICATION_LABELS[code]||'工业通讯状态已变化。');this.emit('state',this.status());}
  status(){
    // A stalled monitor/poll cannot preserve a GOOD classification indefinitely.
    if(this.state.quality==='GOOD'&&this.profile&&this.now()-Date.parse(this.state.updatedAt)>this.profile.communication.pollIntervalMs*3+this.profile.communication.timeoutMs)this.invalidate('COMM_MODBUS_ERROR');
    // One service owns the priority: configuration, NIC, TCP, Modbus, input checks.
    const configured=Boolean(this.profile)&&this.registerMapReady===true;
    const code=!configured?'UNCONFIGURED':this.network&&this.network.status!=='LINK_UP'?this.network.status
      :this.connecting||this.state.state==='CONNECTING'?'CONNECTING':this.state.state;
    return structuredClone({...this.state,state:code,label:COMMUNICATION_LABELS[code],profileConfigured:Boolean(this.profile),registerMapReady:this.registerMapReady===true,profileName:this.profile?.profileName??null,profileId:this.profile?.profileId??null,networkUp:this.network?.status==='LINK_UP',identityChanged:this.network?.identityChanged===true,nicName:this.network?.nic?.name??null,protocol:'Modbus TCP',readOnly:true,dataQuality:this.state.quality,lastGoodTimestamp:this.state.updatedAt,realtimeReady:configured&&this.state.quality==='GOOD'&&code==='CONNECTED'&&this.state.readCount===25&&this.state.validCount===25});
  }
  async start(){this.monitor.on('change',rows=>{void this.detect(rows);});this.monitor.on('unavailable',()=>{this.invalidate('NIC_NOT_FOUND');this.network=null;});
    try{await this.activate(await this.store.active());}catch(error){this.setState('COMM_PROFILE_MISMATCH','INVALID',{issues:[{message:error.message}]});}
    this.monitor.start();this.watchdog=setInterval(()=>this.status(),1000);this.watchdog.unref?.();
  }
  invalidate(code='DISCONNECTED'){
    this.generation++;clearTimeout(this.pollTimer);clearTimeout(this.retryTimer);this.client?.close();this.client=null;this.frames.clear();
    this.setState(code,this.state.frame?'STALE':'DISCONNECTED',{frame:this.state.frame?{...this.state.frame,quality:'STALE'}:null});
  }
  async activate(profile){this.invalidate(profile?'NIC_NOT_FOUND':'UNCONFIGURED');this.profile=profile;this.registerMapReady=Boolean(profile)&&validatePointMap(profile.registerMap).valid;this.network=null;this.state={...this.state,count:0,readCount:0,validCount:0,frame:null,updatedAt:null,missing:[],issues:[]};if(profile&&this.registerMapReady)await this.detect(this.monitor.interfaces);}
  async detect(rows=this.monitor.interfaces){
    if(this.closed||!this.profile||!this.registerMapReady)return;
    const next=matchIndustrialInterface(this.profile.network,rows),previous=this.network;this.network=next;
    if(next.status!=='LINK_UP'){
      if(previous?.status!==next.status||this.client){this.event(next.status==='LINK_DOWN'?'COMM_NIC_LINK_DOWN':next.status==='NIC_NOT_FOUND'?'COMM_NIC_NOT_FOUND':'COMM_PROFILE_MISMATCH',COMMUNICATION_LABELS[next.status]);this.invalidate(next.status);}
      return;
    }
    if(this.testing)return;
    if(previous?.status!=='LINK_UP'){this.event('COMM_NIC_LINK_UP','已检测到工业网络。');this.invalidate('CONNECTING');void this.connect(true);}
    else if(!this.client&&!this.connecting&&!this.retryTimer)void this.connect(false);
  }
  async connect(immediate){
    if(this.closed||this.testing||!this.profile||!this.registerMapReady||this.network?.status!=='LINK_UP'||this.connecting)return;
    clearTimeout(this.retryTimer);this.retryTimer=null;const generation=this.generation,profile=this.profile;
    this.connecting=true;this.setState('CONNECTING',this.state.frame?'STALE':'DISCONNECTED');this.event(this.everConnected?'COMM_RECONNECTING':'COMM_CONNECTING','正在连接现场PLC。',{immediate});
    const client=this.clientFactory({...profile.plc,localAddress:profile.network.localInterfaceIPv4,timeoutMs:profile.communication.timeoutMs});this.client=client;
    client.on('disconnected',error=>{if(this.client!==client||this.closed)return;this.event(['ECONNRESET','EPIPE'].includes(error.code)?'COMM_RESET':error.code==='COMM_TIMEOUT'?'COMM_TIMEOUT':'COMM_DISCONNECTED','PLC通讯已中断。',{reason:error.code});this.invalidate(['COMM_TIMEOUT','COMM_MODBUS_ERROR'].includes(error.code)?'COMM_MODBUS_ERROR':'DISCONNECTED');queueMicrotask(()=>void this.connect(true));});
    try{
      await client.connect();if(generation!==this.generation){client.close();return;}
      if(this.everConnected)this.event('COMM_RECONNECTED','PLC通讯已恢复。');this.everConnected=true;
      this.setState('CONNECTING',this.state.frame?'STALE':'DISCONNECTED');
    }catch(error){
      client.close();if(generation!==this.generation)return;this.client=null;
      const code=['EADDRNOTAVAIL','EACCES','COMM_BIND_FAILED'].includes(error.code)?'COMM_BIND_FAILED':error.code==='ECONNREFUSED'?'COMM_PORT_UNAVAILABLE':'WAITING_FOR_PLC';
      if(generation!==this.generation)return;this.setState(code,this.state.frame?'STALE':'DISCONNECTED',{lastErrorCode:error.code});if(error.code==='COMM_TIMEOUT')this.event('COMM_TIMEOUT','PLC连接超时。');
      this.retryTimer=setTimeout(()=>{this.retryTimer=null;void this.connect(false);},profile.communication.reconnectIntervalMs);this.retryTimer.unref?.();
    }finally{this.connecting=false;if(generation!==this.generation&&!this.closed&&this.network?.status==='LINK_UP'&&!this.client)queueMicrotask(()=>void this.connect(true));}
    if(this.client===client&&client.connected&&generation===this.generation)void this.poll(generation,client);
  }
  async readMapping(client,mapping){const value=decodeRegisters(await client.read(mapping.functionCode,registerOffset(mapping),REGISTER_WIDTH[mapping.dataType]),mapping);return value;}
  async acquire(client,p){
    let values={},actualValue=null,sequenceValue=null;
      const blocks=buildRegisterBlocks(p.registerMap);let consistent=false,decodeErrors=[],readFields=new Set();
      for(let attempt=0;attempt<2&&!consistent;attempt++){
        values={};decodeErrors=[];readFields=new Set();const before=p.sequence?.enabled?await this.readMapping(client,p.sequence):null;
        for(const block of blocks){const bytes=await client.read(block.functionCode,block.start,block.count);
          for(const point of block.points){const rawBytes=bytes.subarray((point.start-block.start)*2,(point.end-block.start)*2);if(rawBytes.length===REGISTER_WIDTH[point.mapping.dataType]*2)readFields.add(point.mapping.canonicalField);
            try{const raw=decodeRegisters(rawBytes,point.mapping),value=convertUnit(raw,point.mapping.sourceUnit,sourceUnitFor(point.mapping.canonicalField));if(!Number.isFinite(value))throw Error('PLC数据单位无法转换。');values[point.mapping.canonicalField]=value;}catch(error){decodeErrors.push({field:point.mapping.canonicalField,message:error.message});}}}
        if(p.actualS5?.enabled)try{actualValue=convertUnit(await this.readMapping(client,p.actualS5),p.actualS5.sourceUnit,'t');}catch(error){if(!client.connected)throw error;actualValue=null;this.event('COMM_REGISTER_DECODE_ERROR','S5实际值暂时无法读取。');}
        const after=p.sequence?.enabled?await this.readMapping(client,p.sequence):null;consistent=before===after;sequenceValue=after;
      }
      if(!consistent)throw new CommunicationError('COMM_DATA_INVALID','读取期间PLC采样标识发生变化，本轮数据已丢弃。',{readCount:readFields.size});

    return {values,actualValue,sequenceValue,decodeErrors,readFields:[...readFields]};
  }
  async testProfile(raw){
    if(this.testing)throw new CommunicationError('COMM_MODBUS_ERROR','连接测试正在进行，请稍候。',{},409);
    const p=validateProfile(raw),network=matchIndustrialInterface(p.network,this.monitor.interfaces);
    if(network.status!=='LINK_UP')throw new CommunicationError('COMM_PROFILE_MISMATCH',COMMUNICATION_LABELS[network.status]);
    const currentClient=this.client,generation=this.generation;
    if(currentClient?.connected){
      const connectionIdentity=profile=>JSON.stringify([profile.network,profile.plc,profile.registerMap,profile.actualS5,profile.sequence]);
      if(connectionIdentity(p)!==connectionIdentity(this.profile))throw new CommunicationError('COMM_PROFILE_MISMATCH','当前设备正在实时读取。测试连接请使用当前设备配置，避免干扰现有通讯。',{},409);
      this.testing=true;
      try{
        // Finish any outstanding transaction, then read on the same socket.
        await this.readTask;
        if(this.client!==currentClient||generation!==this.generation||!currentClient.connected)throw new CommunicationError('COMM_DISCONNECTED','当前PLC连接已中断，请重新检测。');
        clearTimeout(this.pollTimer);
        const result=await this.poll(generation,currentClient);
        if(!result)throw new CommunicationError('COMM_MODBUS_ERROR',this.status().label||COMMUNICATION_LABELS.COMM_MODBUS_ERROR);
        return {...result,actualAvailable:this.state.frame?.observedAvailable===true};
      }finally{this.testing=false;await this.detect();}
    }
    this.testing=true;this.invalidate('CONNECTING');
    const client=this.clientFactory({...p.plc,localAddress:p.network.localInterfaceIPv4,timeoutMs:p.communication.timeoutMs});
    const timer=setTimeout(()=>client.close(),15000);
    try{await client.connect();const sample=await this.acquire(client,p),check=validateRealtimeFrame(sample.values,this.rangeTable,{},sample);
      this.event(check.valid?'COMM_CONNECTED':'COMM_DATA_INVALID',check.valid?'设备连接测试通过。':'设备连接测试未通过输入检查。',{connectionTest:true,count:check.count});return {...check,actualAvailable:Number.isFinite(sample.actualValue)};
    }finally{clearTimeout(timer);client.close();this.testing=false;this.network=null;if(this.profile)await this.detect();else this.setState('UNCONFIGURED','DISCONNECTED');}
  }
  async poll(generation,client){
    if(generation!==this.generation||this.closed||this.client!==client)return;
    while(this.readTask){
      if(this.readTaskClient===client&&this.readTaskGeneration===generation)return this.readTask;
      await this.readTask;
      if(generation!==this.generation||this.closed||this.client!==client)return;
    }
    const task=this.readCycle(generation,client);this.readTask=task;this.readTaskClient=client;this.readTaskGeneration=generation;
    try{return await task;}finally{if(this.readTask===task)this.readTask=null;}
  }
  async readCycle(generation,client){
    const p=this.profile;let values={},actualValue=null,sequenceValue=null,result;
    try{
      const sample=await this.acquire(client,p);({values,actualValue,sequenceValue}=sample);const decodeErrors=sample.decodeErrors;
      if(generation!==this.generation||this.closed)return;
      const check=validateRealtimeFrame(values,this.rangeTable,{},sample);
      if(!check.valid){this.frames.clear();this.event(decodeErrors.length?'COMM_REGISTER_DECODE_ERROR':check.missing.length?'COMM_DATA_INCOMPLETE':'COMM_DATA_INVALID','PLC工况未通过正式输入检查。',{...check,decodeErrors});this.setState(check.readCount<25?'COMM_DATA_INCOMPLETE':'COMM_DATA_INVALID','INVALID',{...check,frame:this.state.frame?{...this.state.frame,quality:'STALE'}:null});}
      else{
        const timestamp=new Date(this.now()).toISOString(),frameId=`${p.profileId}:${p.profileVersion}:${randomUUID()}`,input=canonicalCase(values,{profile:p,frameId,timestamp,actualValue});
        const frame={frameId,input25Hash:hash(modelInputValues(input)),profileVersion:p.profileVersion,sequenceValue,quality:'GOOD',input,time:this.now(),timestamp,mode:'plc',observed:actualValue,observedAvailable:Number.isFinite(actualValue),observedSource:input.importProvenance.observedSource};
        this.frames.set(frameId,frame);while(this.frames.size>60)this.frames.delete(this.frames.keys().next().value);
        this.setState('CONNECTED','GOOD',{frame,count:25,readCount:25,validCount:25,missing:[],issues:[],updatedAt:timestamp,lastErrorCode:null});
      }
      result={...check,actualAvailable:Number.isFinite(actualValue)};
    }catch(error){if(generation!==this.generation||this.closed)return;this.frames.clear();
      if(!client.connected){this.invalidate('COMM_MODBUS_ERROR');queueMicrotask(()=>void this.connect(true));return;}
      this.event(error.code==='COMM_DATA_INVALID'?'COMM_DATA_INVALID':'COMM_REGISTER_DECODE_ERROR',error.message);
      result={valid:false,count:error.details?.readCount??0,readCount:error.details?.readCount??0,validCount:0,missing:[],issues:[{message:error.message}],errorCode:error.code,message:COMMUNICATION_LABELS[error.code==='COMM_DATA_INVALID'?'COMM_DATA_INVALID':'COMM_MODBUS_ERROR']};
      this.setState(error.code==='COMM_DATA_INVALID'?'COMM_DATA_INVALID':'COMM_MODBUS_ERROR','INVALID',{...result,lastErrorCode:error.code,frame:this.state.frame?{...this.state.frame,quality:'STALE'}:null});
    }
    if(generation===this.generation&&!this.closed&&client.connected){this.pollTimer=setTimeout(()=>void this.poll(generation,client),p.communication.pollIntervalMs);this.pollTimer.unref?.();}
    return result;
  }
  assertInput(input){
    if(input?.importProvenance?.source_type!=='PLC_REALTIME')return;
    const current=this.status(),frame=this.frames.get(input.importProvenance.sample_id);
    if(!current.realtimeReady||!frame||hash(modelInputValues(input))!==frame.input25Hash||input.importProvenance.observed!==frame.observed)throw new CommunicationError('COMM_DATA_INVALID','当前PLC工况已过期或不完整，暂不进行实时预测。',{},409);
    const check=validateRealtimeFrame(Object.fromEntries(MODEL_FEATURES.map((f,i)=>[f.key,modelInputValues(input)[i]])),this.rangeTable);if(!check.valid)throw new CommunicationError('COMM_DATA_INVALID','PLC工况未通过正式有效范围检查。',check,409);
  }
  async redetect({reconnect=false}={}){
    if(this.testing)throw new CommunicationError('COMM_MODBUS_ERROR','连接测试正在进行，请稍候。',{},409);
    if(reconnect){this.invalidate(this.profile?'CONNECTING':'UNCONFIGURED');this.network=null;}
    await this.detect();
    const client=this.client,generation=this.generation;
    if(!reconnect&&client?.connected){
      await this.readTask;
      if(this.client===client&&generation===this.generation&&client.connected){clearTimeout(this.pollTimer);await this.poll(generation,client);}
    }
    return this.status();
  }
  close(){this.closed=true;clearInterval(this.watchdog);this.invalidate('DISCONNECTED');this.monitor.close();}
}

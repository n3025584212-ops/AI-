import React,{useEffect,useState} from 'react';
import { RefreshCw,Settings2,PlugZap,Unplug,BookOpen,Info,ArrowRight,ShieldCheck,BarChart3,ScrollText,Cable } from 'lucide-react';
import MaintenanceGlyph from './MaintenanceGlyph.jsx';
import { OperationsDialog,ServiceBadge,downloadOperationalFile } from './MaintenanceWorkspace.jsx';
import { MODEL_FEATURES } from './modelInputs.js';
import './industrial-connection.css';
import { downloadPointMapTemplate } from './pointMapDownload.js';
const engineeringColumns=['plcVariableName','registerAddress','addressNotation','functionCode','dataType','byteOrder','wordOrder','scale','offset','sourceUnit','enabled'];
const initialProfile=()=>({profileId:'PLC_'+crypto.randomUUID().replaceAll('-',''),profileName:'',schemaVersion:'dkqkar-plc-profile-v1',profileVersion:1,protocol:'MODBUS_TCP',network:{localInterfaceGuid:'',localInterfaceMac:'',localInterfaceName:'',localInterfaceIPv4:''},plc:{host:'',port:502,unitId:''},communication:{pollIntervalMs:1000,timeoutMs:3000,reconnectIntervalMs:5000},registerMap:[],actualS5:null});
const encode=value=>{const bytes=new TextEncoder().encode(JSON.stringify(value));let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
async function filePayload(file){if(file.size>2*1024*1024)throw Error('文件最多2 MiB。');const bytes=new Uint8Array(await file.arrayBuffer());let value='';for(const b of bytes)value+=String.fromCharCode(b);return {filename:file.name,base64:btoa(value)};}
export function ConnectionSteps({status,onClose,onDetect,onSettings}){
  const configured=status?.profileConfigured!==false&&status?.registerMapReady!==false;
  const problem=!configured||['UNCONFIGURED','NETWORK_MISMATCH','COMM_PROFILE_MISMATCH','COMM_BIND_FAILED','COMM_DATA_INCOMPLETE','COMM_DATA_INVALID'].includes(status?.state);
  return <OperationsDialog title="如何连接现场 PLC" onClose={onClose} footer={<><button className="maint-button" onClick={onClose}>关闭</button><button className="maint-button" onClick={onDetect}>重新检测</button>{problem&&<button className="maint-button" onClick={onSettings}>打开连接设置</button>}</>}>
    <p>设备完成一次连接配置后，日常连接无需再次填写通讯参数。</p>
    {(status?.profileConfigured===false||status?.registerMapReady===false||status?.state==='UNCONFIGURED')&&<p>尚未完成设备连接设置。请联系维护人员进入“连接设置”完成一次设备配置。配置完成后，后续日常使用无需重复设置。</p>}
    <dl className="comm-facts"><dt>工业网线</dt><dd>{status?.networkUp?'已连接':'未连接'}</dd><dt>PLC</dt><dd>{!configured?'尚未完成设备连接设置':status?.realtimeReady?'已连接':status?.state==='CONNECTING'?'正在连接现场PLC':status?.label||'等待中'}</dd><dt>读取完整度</dt><dd>{status?.readCount??status?.count??0} / 25</dd><dt>有效数据</dt><dd>{status?.validCount??0} / 25</dd></dl>
    <ol className="comm-steps"><li><h4>确认设备</h4><p>确认软件已启动，现场PLC已经开机并处于正常工作状态，且已完成一次设备连接配置。</p></li><li><h4>找到工业网口</h4><p>找到工控机上已经配置好的“工业网口”。请使用这个网口，避免接到办公、互联网或其他未配置网口。</p></li><li><h4>连接网线</h4><p>使用工业以太网线连接现场PLC与工控机工业网口。首次设备配置完成后，无需再次输入地址、端口或数据地址。</p></li><li><h4>等待自动检测</h4><p>对于已经完成设备连接配置的PLC，插入工业网线后，软件会自动检测并连接，无需再次填写通讯参数。</p></li><li><h4>确认连接成功</h4><p>页面显示“PLC已连接”，读取完整度和有效数据均为“25 / 25”，且实时预测运行中，即表示可以使用。</p></li></ol>
    <h4>遇到问题时</h4><p>未检测到工业网络：检查网线是否插紧、是否连接到正确工业网口。</p><p>暂未收到PLC响应：检查PLC是否开机、工业网络是否正常。</p><p>工况数据不完整：点击“查看缺少的数据”。</p><p>部分工况数据异常：点击“查看异常数据”，请维护人员核对数值、单位和有效范围。</p><p>设备数据配置不匹配：请维护人员打开连接设置，检查设备配置。</p>
  </OperationsDialog>;
}
function ConnectionSettings({api,status,onClose,onNotify}){
  const [profile,setProfile]=useState(null),[interfaces,setInterfaces]=useState([]),[savedProfiles,setSavedProfiles]=useState([]),[review,setReview]=useState(null),[confirmed,setConfirmed]=useState(false),[details,setDetails]=useState(false),[editIndex,setEditIndex]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const operate=async fn=>{setBusy(true);setMessage('');try{await fn();}catch(error){setMessage(error.message);}finally{setBusy(false);}};
  const discover=async()=>{const info=await api('/communication/interfaces');setInterfaces(info.interfaces);setSavedProfiles(info.profiles);return info;};
  useEffect(()=>{void operate(async()=>{const info=await discover();const p=info.profile||initialProfile();setProfile(p);setReview({valid:Boolean(info.profile),count:p.registerMap.filter(m=>m.enabled).length,errors:[],missing:[]});});},[]);
  const change=fn=>{setProfile(fn);setConfirmed(false);};
  const reviewMap=async rows=>{const result=await api('/communication/point-map/review',{method:'POST',body:JSON.stringify({filename:'point-map.json',base64:encode(rows)})});setReview(result);return result;};
  const importFile=async(event,kind)=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;await operate(async()=>{
    if(kind==='profile'){const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())),result=await api('/communication/profile/review',{method:'POST',body:JSON.stringify({profile:raw})});change(()=>result.profile);setReview({valid:true,count:25,errors:[],missing:[]});setDetails(true);setMessage('设备配置已读入，请核对工业网口和25项映射后确认保存。');}
    else {const result=await api('/communication/point-map/review',{method:'POST',body:JSON.stringify(await filePayload(file))});change(p=>({...p,registerMap:result.registerMap,actualS5:result.actualS5}));setReview(result);setDetails(true);}
  });};
  if(!profile)return <OperationsDialog title="连接设置" onClose={onClose}><p>{message||'正在读取设备连接设置……'}</p></OperationsDialog>;
  const selectNic=guid=>{const nic=interfaces.find(n=>n.guid===guid);if(!nic)return;change(p=>({...p,network:{localInterfaceGuid:nic.guid,localInterfaceMac:nic.mac,localInterfaceName:nic.name,localInterfaceIPv4:nic.ipv4.includes(p.network.localInterfaceIPv4)?p.network.localInterfaceIPv4:nic.ipv4.length===1?nic.ipv4[0]:''}}));};
  const rows=[...profile.registerMap,...(profile.actualS5?[profile.actualS5]:[])],selectedMap=editIndex===null?null:rows[editIndex];
  const updateMap=(field,value)=>{
    const next=rows.map((r,i)=>i===editIndex?{...r,[field]:value}:r);change(p=>({...p,registerMap:next.filter(r=>r.canonicalField!=='actualValue'),actualS5:next.find(r=>r.canonicalField==='actualValue')||null}));setReview(null);
  };
  return <OperationsDialog title="连接设置" onClose={onClose} footer={<><button className="maint-button" onClick={onClose}>关闭</button><button className="maint-button" disabled={busy||!review?.valid||!confirmed} onClick={()=>operate(async()=>{const value=await api('/communication/profile/save',{method:'POST',body:JSON.stringify({profile,activate:true})});setProfile(value.profile);setConfirmed(false);await discover();setMessage('已保存为当前设备，软件将自动检测并连接。');onNotify?.('设备连接设置已保存');})}>保存并设为当前设备</button></>}>
    <div className="comm-settings-form">
      <label>设备名称<input value={profile.profileName} onChange={e=>change(p=>({...p,profileName:e.target.value}))}/></label>
      <label>PLC地址<input placeholder="现场已确认的IPv4" value={profile.plc.host} onChange={e=>change(p=>({...p,plc:{...p.plc,host:e.target.value}}))}/></label>
      <label>工业网口<select value={profile.network.localInterfaceGuid} onChange={e=>selectNic(e.target.value)}><option value="">请选择已配置的工业网口</option>{interfaces.map(n=><option key={n.guid} value={n.guid}>{n.name} · {n.up?'网线已连接':'网线未连接'}</option>)}</select></label>
      <label>工业网口IPv4<select value={profile.network.localInterfaceIPv4} onChange={e=>change(p=>({...p,network:{...p.network,localInterfaceIPv4:e.target.value}}))}><option value="">请选择预期IPv4</option>{[...new Set([profile.network.localInterfaceIPv4,...(interfaces.find(n=>n.guid===profile.network.localInterfaceGuid)?.ipv4||[])])].filter(Boolean).map(ip=><option key={ip}>{ip}</option>)}</select></label>
      <label>通讯端口<input type="number" min="1" max="65535" value={profile.plc.port} onChange={e=>change(p=>({...p,plc:{...p.plc,port:e.target.value===''?'':Number(e.target.value)}}))}/></label>
      <label>设备编号（Unit ID）<input type="number" min="0" max="255" value={profile.plc.unitId} onChange={e=>change(p=>({...p,plc:{...p.plc,unitId:e.target.value===''?'':Number(e.target.value)}}))}/></label>
    </div>
    <p>数据映射：{review?.count??profile.registerMap.filter(m=>m.enabled).length} / 25 已配置</p><p>设备配置名称：{profile.profileName||'尚未填写'}</p>
    <div className="comm-buttons"><button className="maint-button" disabled={busy} onClick={()=>operate(async()=>{const result=await api('/communication/test',{method:'POST',body:JSON.stringify({profile})});setMessage(result.errorCode?result.message:result.valid?'连接测试通过：读取完整度25 / 25，有效数据25 / 25。请确认后保存设备配置。':`连接已建立，读取完整度${result.readCount??result.count??0} / 25，有效数据${result.validCount??0} / 25。${(result.readCount??result.count??0)<25?'部分工况数据尚未读到，请核对映射。':'部分工况数据异常，请核对解码、单位和有效范围。'}`);})}>测试连接</button><button className="maint-button" onClick={()=>setDetails(!details)}>查看数据映射</button>
      <label className="maint-button comm-file-button">导入点表<input type="file" accept=".csv,.xlsx,.json" disabled={busy} onChange={e=>importFile(e,'map')}/></label><label className="maint-button comm-file-button">导入设备配置<input type="file" accept=".json" disabled={busy} onChange={e=>importFile(e,'profile')}/></label>
      <button className="maint-button" disabled={busy||!savedProfiles.some(p=>p.profileId===profile.profileId)} onClick={()=>operate(async()=>{const {profile:p}=await api('/communication/profile/export',{method:'POST',body:JSON.stringify({profileId:profile.profileId})});downloadOperationalFile('QCDKR_PLC_PROFILE_'+p.profileId+'.json',p);})}>导出设备配置</button>
      <button className="maint-button" disabled={busy} onClick={()=>operate(discover)}>重新识别工业网口</button><button className="maint-button" disabled={busy} onClick={()=>operate(()=>downloadPointMapTemplate())}>下载标准点表</button>
      {status?.identityChanged&&<button className="maint-button" disabled={busy} onClick={()=>operate(async()=>{const nic=interfaces.find(n=>n.name===status.nicName);if(!nic)throw Error('未找到原工业网口。');const value=await api('/communication/profile/rebind',{method:'POST',body:JSON.stringify({profileId:profile.profileId,profileVersion:profile.profileVersion,nicGuid:nic.guid})});setProfile(value.profile);setMessage('已更新工业网卡身份，PLC地址和点表保持不变。');})}>重新绑定工业网卡</button>}
    </div>
    {message&&<p role="status" aria-live="polite" className="comm-message">{message}</p>}
    {savedProfiles.length>0&&<label>已保存的设备<select value={profile.profileId} onChange={e=>operate(async()=>{const value=await api('/communication/profile/export',{method:'POST',body:JSON.stringify({profileId:e.target.value})});change(()=>value.profile);setReview({valid:true,count:25,errors:[],missing:[]});})}><option value={profile.profileId}>{profile.profileName||'当前编辑设备'}</option>{savedProfiles.filter(p=>p.profileId!==profile.profileId).map(p=><option key={p.profileId} value={p.profileId}>{p.profileName}</option>)}</select></label>}
    {details&&<section className="comm-mapping"><h4>工程映射详情</h4><p>字段必须与标准点表完全一致。S5实际值单独读取。</p><div className="comm-table-scroll"><table><thead><tr><th>工况字段</th><th>PLC变量</th><th>数据地址</th><th>源单位</th><th>状态</th><th/></tr></thead><tbody>{MODEL_FEATURES.map(f=>{const m=profile.registerMap.find(m=>m.canonicalField===f.key);return <tr key={f.key}><td>{f.label}</td><td>{m?.plcVariableName||'未配置'}</td><td>{m?.registerAddress??'—'}</td><td>{m?.sourceUnit||'—'}</td><td>{m?.enabled?'已启用':'未配置'}</td><td>{m&&<button onClick={()=>setEditIndex(rows.indexOf(m))}>编辑单项映射</button>}</td></tr>;})}{profile.actualS5&&<tr><td>S5实际值</td><td>{profile.actualS5.plcVariableName}</td><td>{profile.actualS5.registerAddress}</td><td>{profile.actualS5.sourceUnit}</td><td>独立观测</td><td><button onClick={()=>setEditIndex(rows.length-1)}>编辑单项映射</button></td></tr>}</tbody></table></div>
      {selectedMap&&<div className="comm-settings-form"><h4>{selectedMap.canonicalField}</h4>{engineeringColumns.map(field=><label key={field}>{field}{field==='enabled'?<select value={String(selectedMap[field])} onChange={e=>updateMap(field,e.target.value==='true')}><option value="true">true</option><option value="false">false</option></select>:<input value={selectedMap[field]??''} onChange={e=>updateMap(field,['registerAddress','functionCode','scale','offset'].includes(field)&&e.target.value!==''?Number(e.target.value):e.target.value)}/>}</label>)}</div>}
      <details><summary>查看完整工程参数</summary><pre>{JSON.stringify(profile,null,2)}</pre></details>
    </section>}
    <button className="maint-button" disabled={busy||!rows.length} onClick={()=>operate(()=>reviewMap(rows))}>校验25项映射</button>
    {review&&<><p>{review.valid?'25 / 25 映射校验通过，请核对现场点表后确认。':'映射尚未通过，请补齐或修正以下项目。'}</p>{[...(review.errors||[]),...(review.missing||[])].map((r,i)=><p className="comm-error" key={i}>{r.label||r.field}：{r.message||'尚未配置'}</p>)}</>}
    <label className="comm-confirm"><input type="checkbox" checked={confirmed} disabled={!review?.valid||busy} onChange={e=>setConfirmed(e.target.checked)}/>已核对设备地址、工业网口及全部25项映射</label>
  </OperationsDialog>;
}
function ConnectionDiagram(){
  return <svg className="comm-equipment-diagram" viewBox="0 0 560 188" role="img" aria-label="现场PLC通过工业以太网线连接工控机的工业网口示意图">
    <defs>
      <linearGradient id="comm-plc-metal" x2="1" y2="1"><stop stopColor="#8a9eac"/><stop offset=".42" stopColor="#4c6373"/><stop offset="1" stopColor="#293d4d"/></linearGradient>
      <linearGradient id="comm-plc-face" x2="1"><stop stopColor="#526b7b"/><stop offset=".48" stopColor="#405666"/><stop offset="1" stopColor="#253d4d"/></linearGradient>
      <linearGradient id="comm-pc-top" x2="1" y2="1"><stop stopColor="#546877"/><stop offset="1" stopColor="#1b2b36"/></linearGradient>
      <linearGradient id="comm-pc-face" x2="0" y2="1"><stop stopColor="#334957"/><stop offset="1" stopColor="#12232e"/></linearGradient>
      <linearGradient id="comm-wire" x2="0" y2="1"><stop stopColor="#54c4ff"/><stop offset=".5" stopColor="#149bf2"/><stop offset="1" stopColor="#0067b6"/></linearGradient>
    </defs>
    <ellipse cx="90" cy="151" rx="74" ry="9" fill="#020a11" opacity=".35"/><ellipse cx="467" cy="161" rx="83" ry="10" fill="#020a11" opacity=".4"/>
    <g>
      <path d="M17 43 29 34 157 34 147 43Z" fill="#92a2ad"/><path d="M147 43 157 34 157 132 147 141Z" fill="#263a47"/>
      <rect x="17" y="43" width="130" height="98" rx="3" fill="url(#comm-plc-metal)" stroke="#91a9b9" strokeOpacity=".45"/>
      {Array.from({length:5},(_,i)=><g key={i} transform={`translate(${20+i*25},46)`}><rect width="23" height="92" rx="2" fill="url(#comm-plc-face)" stroke="#9eb2bf" strokeOpacity=".25"/><path d="M2 22H21M2 75H21M18 24V73" stroke="#142d3c" strokeWidth="1.5"/><rect x="5" y="8" width="13" height="3" rx="1" fill="#162f3e"/><circle cx="7" cy="17" r="1.5" fill={i===0?'#89bdae':'#9dafba'}/><rect x="5" y="80" width="12" height="7" fill="#1c3443"/><path d="M7 81V86M10 81V86M13 81V86" stroke="#7f97a7" strokeWidth=".8"/><path d="M3 2V6M20 2V6" stroke="#a9bbc7" strokeWidth=".8"/></g>)}
    </g>
    <g>
      <path d="M177 101H375" stroke="#002a47" strokeWidth="8"/><path d="M177 99H375" stroke="#119feb" strokeWidth="5"/><path d="M177 98H375" stroke="#74d1ff" strokeWidth="1" opacity=".65"/>
      <text x="276" y="74" textAnchor="middle" fill="#b8dcee" fontSize="14">工业以太网线</text>
      {[162,375].map((x,i)=><g key={x} transform={`translate(${x},88)`}><rect width="19" height="22" rx="2" fill="#a2b9c7" stroke="#d5e5eb"/><rect x={i===0?7:0} y="3" width="12" height="16" rx="2" fill="url(#comm-wire)"/><path d={i===0?'M0 4H6M0 7H6M0 10H6M0 13H6M0 16H6':'M13 4H19M13 7H19M13 10H19M13 13H19M13 16H19'} stroke="#e5bc6e" strokeWidth="1"/><path d="M5 1V-3H14V1" fill="none" stroke="#cadce6"/></g>)}
    </g>
    <g>
      <path d="M395 52 425 32 547 48 520 69Z" fill="url(#comm-pc-top)" stroke="#6d8391" strokeOpacity=".5"/>
      <path d="M520 69 547 48 547 134 520 156Z" fill="#10232f" stroke="#526975" strokeOpacity=".55"/>
      {Array.from({length:9},(_,i)=><path key={i} d={`M${523+i*2.5} ${74-i*1.9}V${141-i*1.9}`} stroke="#071923" strokeWidth="1.4"/>)}
      <path d="M395 52 520 69 520 156 395 139Z" fill="url(#comm-pc-face)" stroke="#718895" strokeOpacity=".6"/>
      <g transform="translate(403 65) skewY(8)">
        {Array.from({length:20},(_,i)=><path key={i} d={`M${i*5.3} 0V16`} stroke="#071b27" strokeWidth="2.4"/>)}
        <rect y="24" width="16" height="7" rx="1" fill="#069ed6" stroke="#9fd6eb" strokeWidth=".6"/><rect y="37" width="16" height="7" rx="1" fill="#087cbb" stroke="#8abfd9" strokeWidth=".6"/>
        {Array.from({length:5},(_,i)=><g key={i} transform={`translate(${23+i*17},25)`}><rect width="14" height="18" rx="1" fill="#091a25" stroke="#8aa0ad" strokeWidth="1"/><path d="M3 3H11V12H8V15H5V12H3Z" fill="#253e4e"/><path d="M4 3V7M6 3V7M8 3V7M10 3V7" stroke="#c5b384" strokeWidth=".7"/></g>)}
        <circle cx="5" cy="58" r="4.5" fill="#142e40" stroke="#78adc6"/><circle cx="25" cy="58" r="2" fill="#a9bfd0"/><circle cx="108" cy="58" r="3" fill="#8c9faa"/>
      </g>
    </g>
  </svg>;
}
export default function IndustrialConnectionWorkspace({api,connection,predictionState,currentInput,onNotify,onNavigate}){
  const [dialog,setDialog]=useState(null),status=connection.status;
  const [twinStand,setTwinStand]=useState(null);
  useEffect(()=>{
    const handler=event=>{const stand=String(event.detail?.stand||'').toUpperCase();if(/^S[1-5]$/.test(stand))setTwinStand(stand);};
    window.addEventListener('qcdkr:stand-selected',handler);
    return()=>window.removeEventListener('qcdkr:stand-selected',handler);
  },[]);
  const detect=()=>connection.redetect().catch(error=>onNotify?.(error.message));
  const quality=status?.dataQuality??status?.quality,readCount=status?.readCount??status?.count??0,validCount=status?.validCount??0;
  const configured=status?.profileConfigured!==false&&status?.registerMapReady!==false;
  const live=configured&&status?.realtimeReady===true&&quality==='GOOD'&&readCount===25&&validCount===25,currentPlc=currentInput?.importProvenance?.source_type==='PLC_REALTIME';
  const prediction=live&&currentPlc?(predictionState==='READY'?'运行中 · 已更新':predictionState==='PREDICTING'?'运行中 · 正在计算':predictionState==='FAILED'?'预测暂未完成':'等待预测服务'):'暂停，等待完整实时工况';
  const updated=quality==='STALE'?'数据已停止更新':status?.lastGoodTimestamp?new Date(status.lastGoodTimestamp).toLocaleString('zh-CN',{hour12:false}):'尚无实时数据';
  const label=status&&!configured?'尚未完成设备连接设置':status?.label||'正在读取连接状态';
  const unconfigured=status?.profileConfigured===false||status?.registerMapReady===false||status?.state==='UNCONFIGURED';
  const tone=live?'good':!status||!configured?'idle':['NIC_NOT_FOUND','LINK_DOWN','NETWORK_MISMATCH','COMM_BIND_FAILED','COMM_PROFILE_MISMATCH'].includes(status.state)?'bad':'warn';
  const primary=unconfigured
    ?{label:'打开连接设置',icon:<Settings2 size={16}/>,run:()=>setDialog('settings')}
    :live
      ?{label:'重新连接',icon:<RefreshCw size={16}/>,run:()=>connection.reconnect().catch(error=>onNotify?.(error.message))}
      :{label:'重新检测',icon:<RefreshCw size={16}/>,run:detect};
  const invalidItems=status?.issues?.filter(r=>!status?.missing?.some(m=>m.field===r.field))||[];
  return <section className="industrial-connection"><header><div><h1><span className="page-identity-icon is-glyph"><MaintenanceGlyph kind="storage"/></span>工业设备连接</h1><p>连接现场PLC后，QCDKR可自动读取轧机工况，并进行S5轧制力实时预测。</p></div><div className="comm-header-actions">{twinStand&&<button type="button" className="maint-button" onClick={()=>onNavigate?.('overview')}>3D 选中 {twinStand} · 在3D中查看</button>}<button className="maint-button" onClick={()=>setDialog('settings')}><Settings2 size={16}/>连接设置</button></div></header>
    <div className="comm-main">
    <div className="comm-col comm-col-left">
    <div className="comm-status-panel">
      <div className={['comm-status-header',live?'is-connected':'',tone==='warn'?'is-warn':'',tone==='bad'?'is-bad':''].filter(Boolean).join(' ')}><div className="comm-plug-icon">{live?<PlugZap size={40}/>:<Unplug size={40}/>}</div><div className="comm-status-heading"><h2><ServiceBadge good={live} tone={tone}>{label}</ServiceBadge></h2><p>工业网线：{status?.networkUp?'已连接':'未连接'}</p></div></div>
      <div className="comm-connection-copy">
      {!status?.networkUp&&<p>请将工控机的“工业网口”与现场PLC使用网线连接。</p>}
      {status&&!configured?<p>尚未完成设备连接设置，请由维护人员先完成一次连接配置。</p>:<p>对于已经完成设备连接配置的PLC，插入工业网线后，软件会自动检测并连接，无需再次填写通讯参数。</p>}
      {status?.state==='CONNECTING'&&<p>已检测到工业网络。正在连接PLC并读取工况，请稍候，无需其他操作。</p>}
      {status?.identityChanged&&<p>检测到工业网卡标识变化，请维护人员在连接设置中确认并重新绑定。</p>}
      </div>
      <div className="comm-buttons comm-main-actions"><button className="maint-button comm-primary" onClick={primary.run}>{primary.icon}{primary.label}</button>{status&&!unconfigured&&<button className="maint-button" onClick={detect}><RefreshCw size={16}/>重新检测</button>}<button className="maint-button" onClick={()=>setDialog('steps')}><BookOpen size={16}/>查看详细连接步骤</button>{(status?.missing?.length||status?.issues?.length)>0&&<button className="maint-button" onClick={()=>setDialog('missing')}>{status?.missing?.length?'查看缺少的数据':'查看异常数据'}</button>}</div>
      <div className="comm-readouts"><dl className="comm-facts"><dt>设备名称</dt><dd>{status?.profileName||'尚未配置'}</dd><dt>通讯方式</dt><dd>Modbus TCP · 只读</dd><dt>工业网卡</dt><dd>{status?.nicName||(unconfigured?'配置后选择工业网口':'未检测到')}</dd></dl><dl className="comm-facts"><dt>读取完整度</dt><dd>{readCount} / 25</dd><dt>有效数据</dt><dd>{validCount} / 25</dd><dt>S5实际值</dt><dd>{live&&status?.frame?.observedAvailable?'已接收':'暂无'}</dd><dt>最近更新</dt><dd>{updated}</dd><dt>QCDKR实时预测</dt><dd>{prediction}</dd></dl></div>
      <div className="comm-read-cells" aria-label={`读取 ${readCount} / 25，有效 ${validCount} / 25`}>{Array.from({length:25},(_,i)=><i key={i} data-read={i<readCount?'true':undefined} data-valid={i<validCount?'true':undefined}/>)}</div>
      {quality==='STALE'&&<p>数据已停止更新，保留的上一帧仅供查看，当前暂停实时预测。</p>}
      {quality==='INVALID'&&<p>为避免使用不完整或无效工况，当前暂不进行正式预测。</p>}
      {status?.state==='COMM_DATA_INVALID'&&invalidItems.map((r,i)=><p className="comm-error" key={r.field||i}>{r.label||'当前数据'}：{Number.isFinite(r.value)?<>当前值 {r.value.toFixed(3)} {r.unit}；有效范围 {Number.isFinite(r.min)?r.min.toFixed(3):'—'} ～ {Number.isFinite(r.max)?r.max.toFixed(3):'—'} {r.unit}</>:r.message||'已读取，但数值未通过检查'}</p>)}
      {connection.error&&<p role="alert">{connection.error}</p>}
    </div>
    </div>
    <div className="comm-col comm-col-right">
    <aside className="comm-guide-panel" aria-label="设备连接示意与步骤">
      <h2>连接示意图</h2><ConnectionDiagram/>
      <div className="comm-equipment-captions"><div><strong>现场 PLC</strong><span>五机架轧机控制系统</span></div><div><strong>工控机（QCDKR）</strong><span>请使用已配置的“工业网口”</span></div></div>
      <div className="comm-quick-guide"><h3><Info size={17}/>快速说明</h3><ol><li>将PLC工业网线插入工控机的“工业网口”</li><li>确保PLC已开机并处于正常运行状态</li><li>设备完成一次连接配置后，日常无需重复填写参数</li><li>显示“PLC已连接”，读取和有效数据均为25 / 25，即可实时预测</li></ol><button className="maint-button comm-primary" onClick={()=>setDialog('steps')}>查看详细连接步骤<ArrowRight size={16}/></button></div>
    </aside>
    <div className="comm-feature-grid">
      <article className="comm-feature-card"><div className="comm-feature-icon"><Settings2 size={28}/></div><div><h3>自动连接</h3><p>已配置设备插入工业网线后，软件自动检测并连接，无需重复设置。</p></div></article>
      <article className="comm-feature-card comm-feature-safe"><div className="comm-feature-icon"><ShieldCheck size={28}/></div><div><h3>只读保护</h3><p>仅在工业内网中读取PLC数据，不写入设备，不修改网络配置。</p></div></article>
      <article className="comm-feature-card comm-feature-realtime"><div className="comm-feature-icon"><BarChart3 size={28}/></div><div><h3>实时工况</h3><p>读取25项工况数据，检查通过后进行S5轧制力实时预测。</p></div></article>
      <button type="button" className="comm-feature-card comm-feature-logs" onClick={()=>onNavigate?.('logs')}><div className="comm-feature-icon"><ScrollText size={28}/></div><div><h3>日志记录</h3><p>记录连接状态与数据质量，点击查看现有运行日志。</p></div></button>
    </div>
    </div>
    </div>
    {dialog==='steps'&&<ConnectionSteps {...{status}} onClose={()=>setDialog(null)} onDetect={detect} onSettings={()=>setDialog('settings')}/>}
    {dialog==='settings'&&<ConnectionSettings {...{api,status,onNotify}} onClose={()=>setDialog(null)}/>}
    {dialog==='missing'&&<OperationsDialog title="工况数据检查" onClose={()=>setDialog(null)}><p>读取完整度：{readCount} / 25 · 有效数据：{validCount} / 25</p>{status?.missing?.map(r=><p key={r.field}>{r.label}：尚未读到数据</p>)}{invalidItems.map((r,i)=><p key={i}>{r.label||'当前数据'}：{Number.isFinite(r.value)?<>当前值 {r.value.toFixed(3)} {r.unit}，有效范围 {Number.isFinite(r.min)?r.min.toFixed(3):'—'} ～ {Number.isFinite(r.max)?r.max.toFixed(3):'—'} {r.unit}</>:r.message||'已读取，但解码或单位检查未通过，请维护人员核对数据映射。'}</p>)}</OperationsDialog>}
  </section>;
}

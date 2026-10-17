import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
const mac=value=>String(value||'').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
const guid=value=>String(value||'').replace(/[{}]/g,'').toLowerCase();
export function matchIndustrialInterface(network,interfaces) {
  const candidates=interfaces.filter(n=>n.kind==='Ethernet'&&mac(n.mac)===mac(network.localInterfaceMac)&&mac(n.mac).length===12);
  const nic=candidates.find(n=>guid(n.guid)===guid(network.localInterfaceGuid))||candidates.find(n=>n.ipv4.includes(network.localInterfaceIPv4)&&n.name===network.localInterfaceName)||candidates.find(n=>n.ipv4.includes(network.localInterfaceIPv4));
  if(!nic)return {status:'NIC_NOT_FOUND',nic:null};
  if(!nic.up)return {status:'LINK_DOWN',nic};
  if(!nic.ipv4.includes(network.localInterfaceIPv4))return {status:'NETWORK_MISMATCH',nic};
  return {status:'LINK_UP',nic,identityChanged:guid(nic.guid)!==guid(network.localInterfaceGuid)};
}
export class IndustrialNicMonitor extends EventEmitter {
  constructor(){super();this.interfaces=[];this.closed=false;}
  start(){
    if(process.platform!=='win32'){this.emit('unavailable','当前工业网卡监测需要Windows。');return;}
    const filename=fileURLToPath(new URL('./nic-watch.ps1',import.meta.url));
    this.child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',filename],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let pending='';this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',chunk=>{
      pending+=chunk;if(pending.length>262144){pending='';return;}
      for(;;){const end=pending.indexOf('\n');if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+1);try{const rows=JSON.parse(line.replace(/^\uFEFF/,''));if(Array.isArray(rows)){this.interfaces=rows;this.emit('change',rows);}}catch{this.emit('unavailable','工业网卡状态读取失败。');}}
    });
    this.child.on('error',()=>this.emit('unavailable','工业网卡状态读取失败。'));
    this.child.on('exit',()=>{if(!this.closed){this.interfaces=[];this.emit('unavailable','工业网卡状态监测已中断。');this.retry=setTimeout(()=>this.start(),5000);this.retry.unref();}});
    // Drain diagnostic output; only interface/status information reaches the UI.
    this.child.stderr.resume();
  }
  close(){this.closed=true;clearTimeout(this.retry);this.child?.kill();}
}

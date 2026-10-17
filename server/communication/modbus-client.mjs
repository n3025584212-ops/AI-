import net from 'node:net';
import { EventEmitter } from 'node:events';
import { CommunicationError } from './mapping.mjs';

/** Read-only Modbus TCP ADU transport. One outstanding transaction per socket. */
export class ReadOnlyModbusClient extends EventEmitter {
  constructor({host,port,unitId,localAddress,timeoutMs=3000,socketFactory=()=>new net.Socket()}) {
    super();Object.assign(this,{host,port,unitId,localAddress,timeoutMs,socketFactory});this.transaction=0;this.buffer=Buffer.alloc(0);this.closed=true;
    if(!net.isIPv4(localAddress)||!net.isIPv4(host)||!Number.isInteger(unitId)||unitId<0||unitId>255)throw new CommunicationError('COMM_PROFILE_MISMATCH','PLC地址、源网口IPv4和设备编号须明确。');
  }
  async connect() {
    if(this.socket&&!this.closed)throw new CommunicationError('COMM_MODBUS_ERROR','连接已存在。');
    this.closed=false;this.intentional=false;this.buffer=Buffer.alloc(0);this.socket=this.socketFactory();
    this.socket.on('data',chunk=>this.receive(chunk));
    this.socket.on('error',error=>this.lost(error));
    this.socket.on('end',()=>this.lost(Object.assign(new Error('PLC关闭连接'),{code:'FIN'})));
    this.socket.on('close',()=>this.lost(Object.assign(new Error('连接已关闭'),{code:'SOCKET_CLOSED'})));
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(new CommunicationError('COMM_TIMEOUT','PLC连接超时。')),this.timeoutMs);
      const failed=error=>finish(error),connected=()=>{
        if(this.socket.localAddress!==this.localAddress){finish(new CommunicationError('COMM_BIND_FAILED','工业网卡绑定失败。'));return;}
        this.connected=true;finish();
      };
      const finish=error=>{clearTimeout(timer);this.socket.removeListener('connect',connected);this.socket.removeListener('error',failed);this.connectReject=null;if(error){this.close();reject(error);}else resolve();};
      this.connectReject=finish;this.socket.once('connect',connected);this.socket.once('error',failed);
      this.socket.setNoDelay(true);this.socket.setKeepAlive(true,1000);
      // There is deliberately no route/default-interface fallback.
      this.socket.connect({host:this.host,port:this.port,family:4,localAddress:this.localAddress});
    });
  }
  read(functionCode,address,count) {
    if(![3,4].includes(functionCode))return Promise.reject(new CommunicationError('COMM_READ_ONLY','PLC只允许读取保持寄存器和输入寄存器。'));
    if(!Number.isInteger(address)||!Number.isInteger(count)||address<0||count<1||count>125||address+count>65536)return Promise.reject(new CommunicationError('COMM_MODBUS_ERROR','寄存器读取范围无效。'));
    if(!this.connected||this.closed||this.pending)return Promise.reject(new CommunicationError('COMM_DISCONNECTED','PLC尚未连接或上一读取尚未结束。'));
    const id=this.transaction=this.transaction%65535+1,adu=Buffer.alloc(12);
    adu.writeUInt16BE(id,0);adu.writeUInt16BE(0,2);adu.writeUInt16BE(6,4);adu[6]=this.unitId;adu[7]=functionCode;adu.writeUInt16BE(address,8);adu.writeUInt16BE(count,10);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.lost(new CommunicationError('COMM_TIMEOUT','PLC读取超时。')),this.timeoutMs);
      this.pending={id,functionCode,count,resolve,reject,timer};
      this.socket.write(adu,error=>{if(error)this.lost(error);});
    });
  }
  receive(chunk) {
    if(this.closed)return;
    this.buffer=Buffer.concat([this.buffer,chunk]);
    if(this.buffer.length>4096){this.lost(new CommunicationError('COMM_MODBUS_ERROR','PLC响应长度无效。'));return;}
    while(this.buffer.length>=7){
      const length=this.buffer.readUInt16BE(4);
      if(length<3||length>254||this.buffer.readUInt16BE(2)!==0){this.lost(new CommunicationError('COMM_MODBUS_ERROR','PLC通讯头无效。'));return;}
      if(this.buffer.length<6+length)return;
      const adu=this.buffer.subarray(0,6+length);this.buffer=this.buffer.subarray(6+length);const p=this.pending;
      if(!p||adu.readUInt16BE(0)!==p.id||adu[6]!==this.unitId){this.lost(new CommunicationError('COMM_MODBUS_ERROR','PLC响应与当前读取请求不匹配。'));return;}
      if(adu[7]===(p.functionCode|128)&&length===3){this.settle(new CommunicationError('COMM_MODBUS_EXCEPTION','PLC拒绝读取已配置的数据地址。',{exceptionCode:adu[8],functionCode:p.functionCode}));continue;}
      if(adu[7]!==p.functionCode||adu[8]!==p.count*2||length!==3+p.count*2){this.lost(new CommunicationError('COMM_MODBUS_ERROR','PLC响应的数据数量不匹配。'));return;}
      this.settle(null,Buffer.from(adu.subarray(9)));
    }
  }
  settle(error,value){const p=this.pending;if(!p)return;this.pending=null;clearTimeout(p.timer);if(error)p.reject(error);else p.resolve(value);}
  lost(error) {
    if(this.closed)return;
    const connecting=!this.connected;this.connected=false;this.closed=true;this.settle(error);this.connectReject?.(error);this.socket?.destroy();
    if(!this.intentional&&!connecting)this.emit('disconnected',error);
  }
  close(){this.intentional=true;this.connected=false;this.closed=true;this.settle(new CommunicationError('COMM_DISCONNECTED','PLC连接已关闭。'));this.socket?.destroy();}
}

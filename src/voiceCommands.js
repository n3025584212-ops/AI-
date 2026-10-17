const unsupported = message => ({ kind: 'unsupported', message });
const digits = {一:'1',二:'2',两:'2',三:'3',四:'4',五:'5'};
const questionPattern = /[?？]|怎么|怎样|如何|为什么|为何|什么|是否|能否|能不能|可不可以|可以吗|多少|几号|哪(?:个|种|里)|吗(?:$|[，。；])/;
const negationPattern = /不要|别(?:再|给我|帮我)?|不许|禁止|不用|无需|不必|不得|不(?:打开|关闭|切换|切到|执行|调整|进入|退出|放大|缩小|暂停|播放)|取消(?:刚才|上个|上一条)/;
const modifier = '(?:切换到|切换成|切换|切到|转到|回到|返回|改为|改成|显示|查看|进入|打开)?';
function clauseActions(input) {
  const clause = input.replace(/^(?:(?:请|麻烦|帮我|给我|请帮我|帮忙))+/,'').replace(/(?:一下|一点|吧|谢谢)$/,'');
  const focusZoom = clause.match(/^(?:放大|拉近)(?:S([1-5])|([1-5])号)(?:机架|主视图)?$/i);
  if(focusZoom)return [{type:'select_stand',stand:'S'+(focusZoom[1]||focusZoom[2])},{type:'zoom',direction:'in'}];
  const stand = clause.match(/^(?:切换到|切到|转到|查看|定位到|定位|选择|选中|显示|看看)?(?:第)?(?:S([1-5])|([1-5])号)(?:机架|主视图)?$/i);
  if (stand) return [{type:'select_stand',stand:'S'+(stand[1]||stand[2])}];
  if(new RegExp('^'+modifier+'(?:整线|整线视图|全部机架|五个机架|整个机组|五机架整线)$').test(clause))return [{type:'set_scope',scope:'line'}];
  if(new RegExp('^'+modifier+'S5主视图$','i').test(clause))return [{type:'set_scope',scope:'s5'}];
  if(new RegExp('^'+modifier+'(?:透壳|透壳模式|透明|透明模式|透明显示)$').test(clause))return [{type:'set_shell',mode:'transparent'}];
  if(new RegExp('^'+modifier+'(?:实体|实体模式|实体显示)$').test(clause))return [{type:'set_shell',mode:'solid'}];
  if(/^(?:只看|仅看|显示|切换到|切到|切换)?(?:仅辊系|辊系视图|辊系模式|辊系)$/.test(clause))return [{type:'set_shell',mode:'hidden'}];
  for(const [view,terms] of [['perspective','透视|透视图|透视视角'],['front','操作侧|操作侧视图|正面|正视图'],['top','俯视|俯视图|顶部视角'],['drive','传动侧|传动侧视图']]){
    if(new RegExp('^'+modifier+'(?:'+terms+')$').test(clause))return [{type:'set_view',view}];
  }
  if(/^(?:播放|开始|启动|继续|恢复|打开)(?:输送动画|设备动画|动画|运动)$/.test(clause))return [{type:'set_motion',playing:true}];
  if(/^(?:暂停|停止|关闭)(?:输送动画|设备动画|动画|运动)$/.test(clause))return [{type:'set_motion',playing:false}];
  if(/^(?:播放|开始|启动|继续|恢复)(?:数据流|数据回放|数据|回放)$/.test(clause))return [{type:'set_stream',playing:true}];
  if(/^(?:暂停|停止)(?:数据流|数据回放|数据|回放)$/.test(clause))return [{type:'set_stream',playing:false}];
  if(/^(?:进入|打开|开启|切换到|切到)?全屏(?:模式|视图|显示)?$/.test(clause))return [{type:'set_fullscreen',expanded:true}];
  if(/^(?:退出|关闭|离开)全屏(?:模式|视图|显示)?$/.test(clause))return [{type:'set_fullscreen',expanded:false}];
  if(/^(?:重置|恢复|复位)(?:相机|视角|观察角度|默认视角|初始视角)$/.test(clause))return [{type:'reset_camera'}];
  if(/^(?:放大|拉近)(?:模型|画面|视图)?$/.test(clause))return [{type:'zoom',direction:'in'}];
  if(/^(?:缩小|拉远)(?:模型|画面|视图)?$/.test(clause))return [{type:'zoom',direction:'out'}];
  if(/^(?:展开|拆开)(?:辊系|轧辊)$/.test(clause))return [{type:'set_explode',expanded:true}];
  if(/^(?:收起|合拢|合上|恢复)(?:辊系|轧辊)$/.test(clause))return [{type:'set_explode',expanded:false}];
  if(/^(?:打开|展开|显示)(?:测点|测点面板|参数检查器)$/.test(clause))return [{type:'set_inspector',open:true}];
  if(/^(?:关闭|收起|隐藏)(?:测点|测点面板|参数检查器)$/.test(clause))return [{type:'set_inspector',open:false}];
  if(/^(?:打开|展开|显示)(?:全部参数|参数|参数表|参数矩阵)$/.test(clause))return [{type:'set_matrix',open:true}];
  if(/^(?:关闭|收起|隐藏)(?:全部参数|参数|参数表|参数矩阵)$/.test(clause))return [{type:'set_matrix',open:false}];
  for(const [page,terms] of [['overview','预测工作台|运行监测|监测页面|预测中心|S5预测中心|工作台|主画面'],['events','异常事件|异常|事件页'],['maintenance','维护设置|维护|设置页'],['logs','日志|运行日志|系统日志'],['data','数据接入|导入数据'],['saved-data','历史|历史工况|历史记录|已保存工况'],['optimize','工艺优化|工况调整|优化|优化页面|优化页'],['reports','报告|报告导出|报告中心']]){
    if(new RegExp('^'+modifier+'(?:'+terms+')$','i').test(clause))return [{type:'navigate',page}];
  }
  return null;
}

/** Parse only complete, explicit commands; never execute a recognized fragment. */
export function parseVoiceCommand(input) {
  if(typeof input!=='string'||!input.trim())return unsupported('没有听清，请再说一次。');
  let text=input.normalize('NFKC').trim();
  text=text.replace(/第([一二两三四五1-5])(?:号)?机架|([一二两三四五1-5])号机架/g,(_,first,second)=>'S'+(digits[first||second]||first||second));
  if(text.length>500)return unsupported('这句话太长，请一次说一个操作。');
  if(negationPattern.test(text)){if(questionPattern.test(text)||/^(?:解释|分析|说明|介绍|请问)/.test(text))return {kind:'question'};return unsupported('已保留当前状态。');}
  const read=text.replace(/S([1-5])机架/gi,'S$1').replace(/[\s，,。.!！?？]/g,'');
  if(/^(?:请|帮我)?(?:(?:读|读出|播报|报告|告诉我)(?:一下)?(?:当前|现在|本次)?(?:S5)?(?:的)?(?:预测|预测值|预测结果|轧制力预测)|(?:现在|当前|本次)?(?:的)?(?:S5)?(?:预测|预测值|预测结果|轧制力预测)(?:是)?(?:多少|怎么样))$/i.test(read))return {kind:'commands',actions:[{type:'read_prediction'}]};
  if(questionPattern.test(text)||/^(?:解释|分析|说明|介绍|请问)/.test(text))return {kind:'question'};
  text=text.replace(/([一二两三四五])号/g,(_,n)=>digits[n]+'号').replace(/S([一二两三四五])/gi,(_,n)=>'S'+digits[n]).replace(/\s+/g,'').replace(/[。.!！]+$/,'');
  const clauses=text.split(/(?:然后|接着|并且|同时|并|再|[，,；;。])/).filter(Boolean);
  if(clauses.length>6)return unsupported('请分成两次说，每次最多六个操作。');
  const actions=[];
  for(const clause of clauses){
    const parsed=clauseActions(clause);
    if(!parsed){
      if(clauses.length>1||/^(?:请|麻烦|帮我|给我)?(?:打开|关闭|切换|切到|进入|退出|删除|保存|导出|生成|执行|运行|修改|设置|调整|暂停|停止|播放|开始|放大|缩小|重置)/.test(clause)||/[{};=]|javascript:|\b(?:eval|alert|fetch)\s*\(/i.test(input))return unsupported('这条操作还不支持，请换个说法。');
      return {kind:'question'};
    }
    actions.push(...parsed);
  }
  return actions.length?{kind:'commands',actions}:unsupported('没有听清，请再说一次。');
}

// Renderer refresh only. This module has no backend, process, shell or filesystem dependency.
function createRendererRefresh(lifecycle) {
  const denied=()=>({error:'请求来源无效'});
  const refreshWorkspace=()=>{
    if(!lifecycle.isAlive())return denied();
    lifecycle.contents.send('dkqkar:refresh-workspace-request');
    return {ok:true};
  };
  const reloadRenderer=()=>{
    if(!lifecycle.isAlive())return denied();
    lifecycle.contents.reload();
    return {ok:true};
  };
  lifecycle.on(lifecycle.contents,'before-input-event',(event,input)=>{
    if(input.type!=='keyDown'||input.isAutoRepeat||input.alt||input.isComposing)return;
    if(input.key==='F5'||(input.control||input.meta)&&String(input.key).toLowerCase()==='r'){
      event.preventDefault();refreshWorkspace();
    }
  });
  return Object.freeze({refreshWorkspace,reloadRenderer});
}
module.exports={createRendererRefresh};

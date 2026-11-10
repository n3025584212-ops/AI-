import { createHash, randomUUID } from 'node:crypto';
import { StateError } from './local-state.mjs';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** One business service shared by manual HTTP routes and verified AI capabilities. */
export function createCaseLibrary({ cases, mutate, write, freezeContext }) {
  function validate(input) {
    if (!record(input) || !Object.keys(input).length) throw new StateError('请提供需要保存的工况。');
    if (Object.hasOwn(input, 'name') && (typeof input.name !== 'string' || input.name.length > 200)) throw new StateError('工况名称最多为 200 个字符。');
    if (Object.hasOwn(input, 'input') && !record(input.input)) throw new StateError('input 须为工况对象。');
  }
  async function prepared(input) {
    validate(input);
    const verified = input.prediction?.snapshot_id ? await freezeContext({caseData:input.input,prediction:input.prediction,observation:input.observation}) : null;
    return {...structuredClone(input), ...(verified ? {prediction:verified.prediction,observation:verified.observation,identity_status:'VERIFIED'} : {identity_status:'PENDING'})};
  }
  return {
    list: cases,
    async save(input, { operationId } = {}) {
      const value = await prepared(input);
      const id = operationId ? 'task-' + fingerprint(String(operationId)).slice(0, 32) : randomUUID();
      const item = {...value,id,createdAt:new Date().toISOString(),...(operationId?{operationId,operation_id:operationId}:{})};
      return mutate(async () => {
        const rows = await cases(), existing = rows.find(row=>row.id===id);
        if (existing) {
          if (existing.operationId!==operationId || fingerprint(existing.input)!==fingerprint(item.input) || existing.name!==item.name) throw new StateError('保存操作引用已用于其他内容。',409,'OPERATION_ID_CONFLICT');
          return existing;
        }
        // Existing library capacity is preserved; this is not a new task budget.
        if (rows.length>=10000) throw new StateError('已保存 10000 条工况，请先导出并整理工况记录。',409);
        rows.unshift(item); await write(rows); return item;
      });
    },
    async remove(id, { expectedInputHash } = {}) {
      if (typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new StateError('工况 ID 格式无效。');
      return mutate(async()=>{
        const rows=await cases(),item=rows.find(row=>row.id===id);
        if(!item)throw new StateError('该工况不存在。',404,'CASE_NOT_FOUND');
        if(expectedInputHash&&fingerprint(item.input)!==expectedInputHash)throw new StateError('工况记录已变化，请重新核对。',409,'CASE_CHANGED');
        await write(rows.filter(row=>row.id!==id));return {ok:true,deleted:item};
      });
    },
    async restore(original, { operationId } = {}) {
      if(!record(original)||typeof original.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(original.id))throw new StateError('缺少原始工况恢复记录。');
      const value=await prepared(original),item={...value,id:original.id,createdAt:original.createdAt||new Date().toISOString(),restoredAt:new Date().toISOString(),...(operationId?{restoreOperationId:operationId}:{})};
      return mutate(async()=>{
        const rows=await cases(),existing=rows.find(row=>row.id===item.id);
        if(existing){if(fingerprint(existing.input)!==fingerprint(item.input))throw new StateError('该位置已有不同工况，未覆盖。',409,'CASE_CHANGED');return existing;}
        if(rows.length>=10000)throw new StateError('已保存 10000 条工况，请先导出并整理工况记录。',409);
        rows.unshift(item);await write(rows);return item;
      });
    },
  };
}

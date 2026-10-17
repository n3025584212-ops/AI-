export const LOG_PAGE_SIZE = 20;
const pad = value => String(value).padStart(2, '0');
export function formatLocalLogTime(date) {
 return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function parseLocalLogTime(value) {
 if (!value) return null;
 const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value);
 if (!match) return null;
 const [year,month,day,hour,minute] = match.slice(1).map(Number);
 const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00`);
 return Number.isFinite(date.getTime()) && year>0 && date.getFullYear()===year && date.getMonth()===month-1
  && date.getDate()===day && date.getHours()===hour && date.getMinutes()===minute ? date : null;
}
export function defaultLogFilters() {
 return {scope:'realtime',from:'',to:'',level:'',query:'',state:''};
}
export function historicalLogFilters(now = new Date()) {
 return {scope:'history',from:formatLocalLogTime(new Date(now.getTime()-24*60*60*1000)),to:formatLocalLogTime(now),level:'',query:'',state:''};
}
export function logFilterError(filters) {
 const from = parseLocalLogTime(filters.from), to = parseLocalLogTime(filters.to);
 if (filters.from && !from || filters.to && !to) return '请输入有效时间，格式为 YYYY-MM-DD HH:mm。';
 return from && to && from > to ? '结束时间不能早于开始时间。' : '';
}
export function logQuery(filters, category = '') {
 const error = logFilterError(filters); if (error) throw new Error(error);
 const query = new URLSearchParams(); if (category) query.set('category', category);
 if (filters.scope==='realtime') query.set('scope','realtime');
 for (const key of ['from','to','level','query','state']) {
  if (!filters[key]) continue;
  const date = ['from','to'].includes(key) ? parseLocalLogTime(filters[key]) : null;
  // A minute selected as the end includes records through that whole minute.
  query.set(key,date ? new Date(date.getTime()+(key==='to'?59999:0)).toISOString() : filters[key]);
 }
 return query.toString();
}
export async function readLogPage(api, endpoint, query, page = 1, limit = LOG_PAGE_SIZE) {
 const params = new URLSearchParams(query);params.set('limit',String(limit));params.set('offset',String((page-1)*limit));
 const result = await api(`${endpoint}?${params}`);
 if (!Array.isArray(result?.items) || !Number.isSafeInteger(result.total) || result.total<0) throw new Error('日志读取结果无效，请重试。');
 return {items:result.items,total:result.total};
}
export async function readAllLogRows(api, endpoint, query) {
 const params=new URLSearchParams(query);
 const now=Date.now(),specified=params.has('to')?Date.parse(params.get('to')):now;
 params.set('to',new Date(Math.min(now,specified)).toISOString());
 const records=new Map();let offset=0,total=0;
 do {
  params.set('limit','1000');params.set('offset',String(offset));
  const result=await api(`${endpoint}?${params}`);
  if (!Array.isArray(result?.items) || !Number.isSafeInteger(result.total) || result.total<0) throw new Error('日志导出读取失败。');
  total=result.total;
  if (!result.items.length && offset<total) throw new Error('日志导出未读取完整，请重试。');
  for (const item of result.items) records.set(item.id,item);
  offset+=result.items.length;
 } while(offset<total);
 if (records.size!==total) throw new Error('日志在导出期间发生变化，请重试。');
 return [...records.values()];
}

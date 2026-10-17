import {useEffect,useRef} from 'react';
import './csv-import-unit-dialog.css';

export default function CsvImportUnitDialog({inspection,onChoose}) {
  const dialog=useRef(null);
  useEffect(()=>{if(inspection&&!dialog.current?.open)dialog.current?.showModal();else if(!inspection&&dialog.current?.open)dialog.current.close();},[inspection]);
  return <dialog ref={dialog} className="csv-import-unit-dialog" onCancel={event=>{event.preventDefault();onChoose(null);}} aria-label="确认CSV原始轧制力单位">
    {inspection&&<><h2>确认原始轧制力单位</h2><p>{inspection.filename} 使用旧版单位标记。请按数据来源确认，避免重复换算。</p>
      {Number.isFinite(inspection.rawValue)&&<p>文件原数：<strong>{inspection.rawValue}</strong><br/>若原数是 MN，换算后为 <strong>{inspection.convertedValue.toFixed(3)} t</strong>；若原数是 t，数值保持不变。</p>}
      <p>选择适用于文件中的轧制力、实际值及目标值；张力等其他参数保持原有单位。</p>
      <div><button type="button" onClick={()=>onChoose('t')}>原始轧制力是 t</button><button type="button" onClick={()=>onChoose('MN')}>原始轧制力是 MN</button><button type="button" onClick={()=>onChoose(null)}>取消导入</button></div></>}
  </dialog>;
}

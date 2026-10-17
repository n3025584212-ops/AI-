const names={force:'轧制力',speed:'轧制速度',tension:'后张力',bendingForce:'弯辊力'};

// Values live in the dashboard cards and S5 trend. Keep only the clickable
// machine markers in the 3D scene so equipment stays unobstructed.
export default function SpatialData({anchors,selected,scope,onSelect}) {
  const visible=anchors.filter(a=>a.visible&&(scope==='line'||a.stand==='S5'));
  return <div className="spatial-data">
    {visible.map(a=><button key={a.stand} className={`spatial-anchor ${a.stand==='S5'?'s5-anchor':''} ${a.stand===selected?'is-selected':''}`} style={{left:`${a.x*100}%`,top:`${a.y*100}%`}} onClick={()=>onSelect(a.stand)} aria-label={`查看 ${a.stand} 测点`} title={`${a.stand} ${names[a.metric]}`}>{a.stand}</button>)}
  </div>;
}
import { createRoot } from 'react-dom/client';
import AssistantPetScene from './AssistantPetScene.jsx';
import './assistant-experience.css';
function Preview(){
  return <div className="assistant-pet" style={{position:'absolute',left:30,top:30,width:360,height:500}}>
    <AssistantPetScene model="engineer" taskPhase="IDLE" engaged={false} hovered={false} dragging={false}/>
  </div>;
}
createRoot(document.getElementById('root')).render(<Preview/>);

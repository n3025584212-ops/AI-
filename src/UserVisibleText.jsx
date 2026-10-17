import { userTextProjection } from './userVisibleText.js';
import './user-visible-text.css';

export default function UserVisibleText({ value }) {
 const display=userTextProjection(value);
 return <div className="user-visible-text"><span>{display.text}</span>{display.technical&&<details className="user-technical-text"><summary>查看技术信息</summary><pre>{display.raw}</pre></details>}</div>;
}

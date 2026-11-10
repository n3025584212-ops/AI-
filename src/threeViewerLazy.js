import { lazy } from 'react';

// 同一个 lazy 组件在工作台、跨页孪生面板、模型面板之间共享，
// 避免多个 lazy 包装重复发起同一个动态 import 导致 Suspense 悬挂。
const ThreeViewer = lazy(() => import('./ThreeViewer.jsx'));
export default ThreeViewer;

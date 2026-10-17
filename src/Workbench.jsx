import ModelPanel from './ModelPanel.jsx';

export default function Workbench({ modelProps, result, dirty, autoStatus }) {
  return <div className="workbench s5-workbench">
    <ModelPanel {...modelProps} result={result} dirty={dirty} autoStatus={autoStatus} full workspace />
  </div>;
}
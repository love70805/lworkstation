import { Label, Meter } from 'react-aria-components';

// BoardUI Meter and ProgressTrack, MIT (boardui.com/r/meter.json and
// /r/progress.json). The workspace uses the determinate, labelled variant.
export default function BoardMeter({ label, value, maxValue, valueLabel }) {
  return <Meter className="board-meter" value={value} maxValue={maxValue} valueLabel={valueLabel}>
    {({ percentage, valueText }) => <>
      <div className="board-meter-heading"><Label>{label}</Label><span>{valueText}</span></div>
      <div className="board-meter-track" aria-hidden="true"><span style={{ translate: `${Math.min(100, Math.max(0, percentage)) - 100}% 0` }} /></div>
    </>}
  </Meter>;
}

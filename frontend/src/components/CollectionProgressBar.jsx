// The fill follows reported work. Animation indicates activity, never elapsed-time completion.
export default function CollectionProgressBar({ label, completed, total, active = false }) {
  const known = Number.isFinite(total) && total > 0 && Number.isFinite(completed);
  const value = known ? Math.min(total, Math.max(0, completed)) : null;
  return <div className={`collection-progress-track${active ? ' is-active' : ''}${known ? '' : ' is-waiting'}`}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={known ? total : undefined}
    aria-valuenow={known ? value : undefined} aria-valuetext={known ? `${value} / ${total}` : '等待进度确认'}>
    <div className="collection-progress-fill" style={{ width: `${known ? value / total * 100 : 0}%` }} />
    {active ? <span className="collection-progress-pulse" aria-hidden="true" /> : null}
  </div>;
}

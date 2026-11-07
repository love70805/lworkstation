// BoardUI plain StatCard, using local type, icon and theme tokens.
// The MIT notice is shipped in public/licenses/boardui.txt.
export default function BoardStatCard({ icon: Icon, label, value, caption }) {
  return <section className="dashboard-metric-card">
    <div className="metric-label"><Icon size={15} aria-hidden="true" /><small>{label}</small></div>
    <strong>{value}</strong>
    {caption && <em>{caption}</em>}
  </section>;
}

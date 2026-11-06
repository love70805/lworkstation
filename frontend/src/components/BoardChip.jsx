import { forwardRef } from 'react';

// BoardUI's MIT-licensed Chip, adapted to React 18 and the workstation badge
// tokens. BoardUI's original color pairs map to our existing semantic tones.
// The accompanying notice is shipped in public/licenses/boardui.txt.
const colors = { neutral: 'badge-neutral', lime: 'badge-success', orange: 'badge-warning' };

export const BoardChip = forwardRef(function BoardChip({ color = 'neutral', className = '', ...props }, ref) {
  return <span ref={ref} className={`badge ${colors[color]} ${className}`.trim()} {...props} />;
});

import { forwardRef } from 'react';

// BoardUI's MIT-licensed Chip, adapted to React 18 and the workstation badge
// tokens. BoardUI's original color pairs map to our existing semantic tones.
// The accompanying notice is shipped in public/licenses/boardui.txt.
const tones = { neutral: 'neutral', lime: 'success', orange: 'warning' };

export const BoardChip = forwardRef(function BoardChip({ color = 'neutral', tone = tones[color], className = '', ...props }, ref) {
  return <span ref={ref} className={`badge badge-${tone} ${className}`.trim()} {...props} />;
});

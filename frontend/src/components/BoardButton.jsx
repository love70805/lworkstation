import { forwardRef } from 'react';

// BoardUI Button (MIT), with local CSS tokens and a React 18 ref.
export const BoardButton = forwardRef(function BoardButton({
  variant = 'secondary', size = 'medium', leadingIcon: Leading, trailingIcon: Trailing,
  iconOnly = false, children, className = '', loading = false, ...props
}, ref) {
  return <button ref={ref}
    className={`button board-button button-${variant} board-button-${size} ${iconOnly ? 'board-button-icon' : ''} ${className}`.trim()}
    aria-busy={loading || undefined} {...props}>
    {Leading && <Leading className={`board-button-glyph ${loading ? 'spin' : ''}`.trim()} aria-hidden="true" />}
    {!iconOnly && children != null && <span className="board-button-label">{children}</span>}
    {!iconOnly && Trailing && <Trailing className="board-button-glyph" aria-hidden="true" />}
  </button>;
});

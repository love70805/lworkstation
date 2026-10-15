import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from 'react';

// Keep horizontal controls within reach while the document scrolls vertically.
const TableScrollArea = forwardRef(function TableScrollArea({ children, label, className = '' }, forwardedRef) {
  const areaRef = useRef(null), railRef = useRef(null);
  const [width, setWidth] = useState(0);
  const setArea = useCallback(node => {
    areaRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  useLayoutEffect(() => {
    const area = areaRef.current;
    const update = () => setWidth(area.scrollWidth > area.clientWidth + 1 ? area.scrollWidth : 0);
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(area);
    if (area.firstElementChild) observer?.observe(area.firstElementChild);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  useLayoutEffect(() => {
    if (railRef.current) railRef.current.scrollLeft = areaRef.current.scrollLeft;
  }, [width]);
  const sync = (source, target) => {
    if (target && Math.abs(target.scrollLeft - source.scrollLeft) > 1) target.scrollLeft = source.scrollLeft;
  };
  return <div className="table-scroll-frame">
    <div className={`table-wrap ${className}`} ref={setArea} role={label ? 'region' : undefined} aria-label={label} tabIndex={label ? 0 : undefined} onScroll={event => sync(event.currentTarget, railRef.current)}>{children}</div>
    {width > 0 ? <div className="table-scrollbar" ref={railRef} role="region" aria-label="横向滚动表格" tabIndex={0} onScroll={event => sync(event.currentTarget, areaRef.current)}><div style={{ width }} /></div> : null}
  </div>;
});

export default TableScrollArea;

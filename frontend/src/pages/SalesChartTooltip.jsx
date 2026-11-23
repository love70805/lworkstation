import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useChartHover() {
  const [anchor, setAnchor] = useState(null);
  const keyboardAnchor = useRef(null);
  const open = anchor != null;
  useEffect(() => {
    if (!open) return;
    const dismiss = () => { keyboardAnchor.current = null; setAnchor(null); };
    const onKey = event => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', dismiss);
    };
  }, [open]);

  function hide(event) {
    const target = event.currentTarget;
    setAnchor(current => current === target ? null : current);
  }
  return { anchor, events: {
    onFocus: event => {
      if (event.currentTarget.matches(':focus-visible')) {
        keyboardAnchor.current = event.currentTarget;
        setAnchor(event.currentTarget);
      }
    },
    onBlur: event => {
      if (keyboardAnchor.current === event.currentTarget) keyboardAnchor.current = null;
      hide(event);
    },
    // Scrolling can put a new bar under a stationary pointer during keyboard navigation.
    onMouseEnter: event => { if (!keyboardAnchor.current?.isConnected) setAnchor(event.currentTarget); },
    onMouseMove: event => {
      if (anchor && (event.movementX || event.movementY)) {
        keyboardAnchor.current = null;
        if (anchor !== event.currentTarget) setAnchor(event.currentTarget);
      }
    },
    onMouseLeave: event => { if (!keyboardAnchor.current?.isConnected) hide(event); },
  } };
}

const MARGIN = 8;
const GAP = 12;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function spacesAround(rect, width, height) {
  const right = width - MARGIN, bottom = height - MARGIN;
  return [
    { left: rect.right + GAP, top: MARGIN, right, bottom },
    { left: MARGIN, top: MARGIN, right: rect.left - GAP, bottom },
    { left: MARGIN, top: MARGIN, right, bottom: rect.top - GAP },
    { left: MARGIN, top: rect.bottom + GAP, right, bottom },
  ].map(area => {
    const left = Math.max(MARGIN, area.left), top = Math.max(MARGIN, area.top);
    return { left, top, width: Math.min(right, area.right) - left, height: Math.min(bottom, area.bottom) - top };
  }).filter(area => area.width > 0 && area.height > 0);
}

function positionTooltip(tip, anchor, plot) {
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = document.documentElement.clientHeight || window.innerHeight;
  const bar = anchor.getBoundingClientRect();
  if (bar.right <= 0 || bar.left >= width || bar.bottom <= 0 || bar.top >= height) {
    tip.style.visibility = 'hidden';
    return;
  }
  const centerX = (bar.left + bar.right) / 2, centerY = (bar.top + bar.bottom) / 2;
  const distance = area => Math.hypot(
    centerX - clamp(centerX, area.left, area.left + area.width),
    centerY - clamp(centerY, area.top, area.top + area.height),
  );
  const nearestFirst = (a, b) => distance(a) - distance(b);
  const aroundPlot = spacesAround(plot.getBoundingClientRect(), width, height).sort(nearestFirst);
  const aroundBar = spacesAround(bar, width, height).sort(nearestFirst);
  const spaces = [...aroundPlot, ...aroundBar];
  tip.removeAttribute('data-compact');
  tip.style.maxWidth = '';
  tip.style.maxHeight = '';
  const fit = size => spaces.find(area => area.width >= size.width && area.height >= size.height);
  let size = tip.getBoundingClientRect();
  let space = fit(size);
  if (!space) {
    // Keep the period and totals readable when the full store breakdown cannot fit.
    tip.setAttribute('data-compact', '');
    size = tip.getBoundingClientRect();
    space = fit(size);
  }
  if (!space) {
    const visibleArea = area => Math.min(area.width, size.width) * Math.min(area.height, size.height);
    space = aroundBar.sort((a, b) => visibleArea(b) - visibleArea(a))[0];
    if (!space) { tip.style.visibility = 'hidden'; return; }
    tip.style.maxWidth = Math.min(size.width, space.width) + 'px';
    tip.style.maxHeight = space.height + 'px';
    size = tip.getBoundingClientRect();
  }
  tip.style.left = clamp(centerX - size.width / 2, space.left, space.left + space.width - size.width) + 'px';
  tip.style.top = clamp(centerY - size.height / 2, space.top, space.top + space.height - size.height) + 'px';
  tip.style.visibility = 'visible';
}

export default function SalesChartTooltip({ anchor, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const tip = ref.current, plot = anchor.closest('.sales-chart-plot');
    if (!plot) return;
    tip.showPopover?.();
    const update = () => positionTooltip(tip, anchor, plot);
    update();
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(plot);
    observer?.observe(anchor);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [anchor, children]);
  return <div ref={ref} popover="manual" className="sales-day-tooltip">{children}</div>;
}

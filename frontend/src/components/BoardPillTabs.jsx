import { useLayoutEffect, useRef, useState } from "react";

// Adapted from BoardUI's PillTabList / PillTab (MIT). The original measured
// selection thumb follows the active pill as counts, text and views change.
export default function BoardPillTabs({ label, items, value, onChange, panelId, lastThumb }) {
  const strip = useRef(null);
  const marker = useRef(null);
  const [thumb, setThumb] = useState(null);
  useLayoutEffect(() => {
    const list = strip.current;
    const measure = () => {
      const selected = list.querySelector("[data-pill-selected]");
      if (!selected) return;
      const next = { left: selected.offsetLeft, top: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight };
      setThumb(previous => previous && Object.keys(next).every(key => next[key] === previous[key]) ? previous : next);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const observeTabs = () => list.querySelectorAll("button").forEach(button => resize?.observe(button));
    resize?.observe(list);
    observeTabs();
    const mutations = new MutationObserver(() => { observeTabs(); measure(); });
    mutations.observe(list, { attributes:true, childList:true, characterData:true, subtree:true, attributeFilter:["data-pill-selected"] });
    return () => { resize?.disconnect(); mutations.disconnect(); };
  }, []);
  useLayoutEffect(() => {
    if (!thumb) return;
    const previous = lastThumb.current;
    lastThumb.current = thumb;
    if (!previous || !thumb.width || !previous.width || !marker.current?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frame = rect => ({ transform:`translate(${rect.left}px,${rect.top}px)`, width:rect.width + "px", height:rect.height + "px" });
    const animation = marker.current.animate([frame(previous), frame(thumb)], { duration:260, easing:"cubic-bezier(.34,1.2,.64,1)" });
    animation.finished.catch(() => {}); // A faster switch can cancel this motion.
    return () => animation.cancel();
  }, [thumb, lastThumb]);
  function navigate(event, index) {
    const target = { ArrowRight:(index + 1) % items.length, ArrowLeft:(index - 1 + items.length) % items.length, Home:0, End:items.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = items[target].id;
    onChange(next);
    requestAnimationFrame(() => document.getElementById(`${panelId}-${next}`)?.focus());
  }
  return <div ref={strip} role="tablist" aria-label={label} className="board-pill-tabs product-view-tabs">
    {thumb && <span aria-hidden="true" ref={marker} className="board-pill-thumb" style={{ transform:`translate(${thumb.left}px,${thumb.top}px)`, width:thumb.width, height:thumb.height }} />}
    {items.map(({ id, icon:Icon, label:text, count }, index) => <button key={id} type="button" id={`${panelId}-${id}`} role="tab" aria-selected={value === id} aria-controls={panelId} tabIndex={value === id ? 0 : -1}
      data-pill-selected={value === id ? "" : undefined} onClick={() => onChange(id)} onKeyDown={event => navigate(event,index)}>
      <Icon size={16} aria-hidden="true" /><span>{text}</span><small>{count}</small>
    </button>)}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from './UI';

// BoardUI Pagination (MIT), boardui.com/r/pagination.json. Keep its numbered
// window and container-width behavior; use the workstation controls and locale.
function pageRange(current, total, sibling) {
  const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
  if (sibling * 2 + 5 >= total) return range(1, total);
  const left = Math.max(current - sibling, 1), right = Math.min(current + sibling, total);
  if (left <= 2 && right < total - 2) return [...range(1, 3 + 2 * sibling), 'dots', total];
  if (left > 2 && right >= total - 2) return [1, 'dots', ...range(total - (2 + 2 * sibling), total)];
  return [1, 'dots', ...range(left, right), 'dots', total];
}

export default function BoardPagination({ page, totalPages, onChange, label }) {
  const nav = useRef(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!nav.current || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 420));
    observer.observe(nav.current);
    return () => observer.disconnect();
  }, [totalPages]);
  if (totalPages <= 1) return null;
  return <nav ref={nav} className="board-pagination" aria-label={label}>
    <Button type="button" icon={ArrowLeft} aria-label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}>{compact ? null : '上一页'}</Button>
    <ul>{pageRange(page, totalPages, compact ? 0 : 1).map((item, index) => item === 'dots'
      ? <li key={'dots-'+index} aria-hidden="true">…</li>
      : <li key={item}><button type="button" aria-label={`第 ${item} 页`} aria-current={page === item ? 'page' : undefined} onClick={() => onChange(item)}>{item}</button></li>)}</ul>
    <Button type="button" icon={ArrowRight} aria-label="下一页" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>{compact ? null : '下一页'}</Button>
  </nav>;
}

// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ProfitGroups from './ProfitGroups';
vi.mock('../components/DataTable', () => ({ default: ({data}) => <table><tbody>{data.map(row => <tr key={row.id}><td>{row.id}</td></tr>)}</tbody></table> }));
let root, host;
afterEach(async()=>{ await act(async()=>root.unmount()); host.remove(); });
it('mounts only opened variants and resets only the list on paging', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  const groups=Array.from({length:30},(_,i)=>({id:String(i),store:'甲',groupSkc:`SKC${i}`,skuCount:1,qty:1,revenue:10,finalizable:false,variants:[{id:`SKU${i}`}]}));
  const prepareRows=vi.fn(rows=>rows);
  await act(async()=>root.render(<ProfitGroups groups={groups} columns={[]} prepareRows={prepareRows}/>));
  expect(host.querySelectorAll('details')).toHaveLength(12);
  expect(prepareRows).not.toHaveBeenCalled();
  const first=host.querySelector('details');
  await act(async()=>{first.open=true;first.dispatchEvent(new Event('toggle'));});
  expect(host.querySelectorAll('table')).toHaveLength(1);
  const scroll=host.querySelector('.profit-groups-scroll');scroll.scrollTop=180;
  await act(async()=>[...host.querySelectorAll('button')].find(el=>el.textContent==='下一页').click());
  expect(scroll.scrollTop).toBe(0);
  expect(host.querySelector('summary').textContent).toContain('SKC12');
  expect(host.querySelector('table')).toBeNull();
});

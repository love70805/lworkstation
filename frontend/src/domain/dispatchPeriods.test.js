import { expect, it } from 'vitest';
import { dispatchSourcePeriods, UNKNOWN_DISPATCH_MONTH } from './dispatchPeriods';
import { suggestSupplementMapping } from './monthlySupplements';

function index(headers, records, source = {}) {
  return dispatchSourcePeriods({
    fileName: '2026年代发.xlsx', sheetName: '明细', headerRow: 1, mapping: suggestSupplementMapping(headers),
    cells: [headers, ...records], ...source,
  }, '2026-10').rows.slice(1);
}

it('uses explicit months, valid dates and the workbook date system ahead of file names', () => {
  const excel1904 = (Date.UTC(2026, 8, 30) - Date.UTC(1904, 0, 1)) / 86400000;
  const dates = [excel1904, '2025年10月1日', '10月21日', '2026.11.01', '2026-02-30'];
  expect(index(['姓名','日期','数量'], dates.map(date => ['甲', date, 2]), {fileName:'202610代发表.xlsx',date1904:true}))
    .toEqual(['2026-09','2025-10','2026-10','2026-11',UNKNOWN_DISPATCH_MONTH]);
  expect(index(['姓名','月份','数量'], [[1,9,1],[2,'2027-01',1],[3,202612,1]]))
    .toEqual(['2026-09','2027-01','2026-12']);
});

it('keeps merged dates and labels ambiguous or invalid sheet months for explicit selection', () => {
  expect(index(['姓名','日期','数量'], [['甲','2026-09-30',1],['乙','',2],['','',0],['丙','',4]], {
    sheetName:'9-10月', merges:[{s:{r:1,c:1},e:{r:2,c:1}}],
  })).toEqual(['2026-09','2026-09','2026-09',UNKNOWN_DISPATCH_MONTH]);
  expect(index(['姓名','数量'], [['甲',2]], {sheetName:'2026-13'})).toEqual([UNKNOWN_DISPATCH_MONTH]);
  expect(index(['姓名','数量'], [['甲',2]], {fileName:'2025年台账.xlsx',sheetName:'10月20日'})).toEqual(['2025-10']);
});

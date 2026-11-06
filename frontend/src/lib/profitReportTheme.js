export const reportRowHeight = 28;
export const reportHeaderHeight = 26;
export const reportBorder = ({ header, band }) => header ? 2 : band ? 4 : 1;

function themeXml(fontColors, fills, grid, divider) {
  const fonts = fontColors.map((color, index) => {
    const bold = [1, 2, 4, 7].includes(index) ? '<b/>' : '';
    return '<font>' + bold + '<color rgb="' + color + '"/><sz val="10"/><name val="Microsoft YaHei"/></font>';
  });
  const solidFills = fills.map(color => '<fill><patternFill patternType="solid"><fgColor rgb="' + color + '"/><bgColor indexed="64"/></patternFill></fill>');
  const borders = [null, grid, divider, divider, divider].map(color => {
    const sides = ['left', 'right', 'top', 'bottom'].map(side => color
      ? '<' + side + ' style="thin"><color rgb="' + color + '"/></' + side + '>'
      : '<' + side + '/>');
    return '<border>' + sides.join('') + '<diagonal/></border>';
  });
  return {
    fonts: '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts>',
    fills: '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' + solidFills.join('') + '</fills>',
    borders: '<borders count="5">' + borders.join('') + '</borders>',
  };
}

// Older saved reports use their original six font slots when projected for download.
export const reportThemeXml = themeXml(Array(6).fill('FF000000'),
  ['FFCADFF2', 'FFFAFBFC', 'FFF0F6F6'], 'FFCBD5E1', 'FFAFBDCD');
export const profitThemeXml = themeXml(
  ['FF253448', 'FF253448', 'FF243C50', 'FF253448', 'FF253448', 'FF253448', 'FF9B4B50', 'FF9B4B50'],
  ['FFDCE8F1', 'FFF7F9FB', 'FFEAF1F1'], 'FFDAE1E8', 'FFB7C7D2');

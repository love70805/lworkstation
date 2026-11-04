// Stable semantic slots are shared by new exports and saved-report projections.
export const reportRowHeight = 28;
export const reportHeaderHeight = 26;
export const reportThemeXml = {
  fonts: `<fonts count="6">${Array.from({length:6},(_,index)=>`<font>${[1,2,4].includes(index)?'<b/>':''}<color rgb="FF000000"/><sz val="10"/><name val="Microsoft YaHei"/></font>`).join('')}</fonts>`,
  fills: `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['FFE9EEF4','FFFAFBFC','FFF0F6F6'].map(color=>`<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>`,
  borders: `<borders count="5">${[0,1,2,3,4].map(index=>`<border>${['left','right','top','bottom'].map(side=>index?`<${side} style="thin"><color rgb="${index===1?'FFCBD5E1':'FFAFBDCD'}"/></${side}>`:`<${side}/>`).join('')}<diagonal/></border>`).join('')}</borders>`,
};
export const reportBorder = ({header,band}) => header ? 2 : band ? 4 : 1;

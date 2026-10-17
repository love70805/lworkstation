// Stable semantic slots are shared by new exports and saved-report projections.
export const reportRowHeight = 28;
export const reportHeaderHeight = 26;
export const reportThemeXml = {
  fonts: `<fonts count="6">${['FF263445','FF155E63','FF344459','FF8F4B34','FF8F4B34','FF526580'].map((color,index)=>`<font>${[1,2,4].includes(index)?'<b/>':''}<color rgb="${color}"/><sz val="10"/><name val="Microsoft YaHei"/></font>`).join('')}</fonts>`,
  fills: `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['FFE9EEF4','FFFAFBFC','FFF0F6F6'].map(color=>`<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>`,
  borders: `<borders count="5">${[0,1,2,3,4].map(index=>`<border>${['left','right','top','bottom'].map(side=>((index===1||index===4)&&['left','right'].includes(side))?`<${side} style="thin"><color rgb="FFE1E7EE"/></${side}>`:((index===2&&side==='bottom')||([3,4].includes(index)&&side==='top'))?`<${side} style="thin"><color rgb="FFD2DDE5"/></${side}>`:`<${side}/>`).join('')}<diagonal/></border>`).join('')}</borders>`,
};
export const reportBorder = ({header,band,number}) => header ? 2 : band ? (number ? 4 : 3) : number ? 1 : 0;

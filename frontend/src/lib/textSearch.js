// Normalize comparison keys only; original identifiers remain untouched.
export const searchKey = value => String(value ?? '').normalize('NFKC').trim().toLocaleUpperCase('zh-CN');
export const includesSearch = (value, query) => searchKey(value).includes(searchKey(query));

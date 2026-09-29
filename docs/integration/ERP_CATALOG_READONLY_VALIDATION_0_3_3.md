# 0.3.3 ERP 商品档案与映射只读核验

核验日期：2026-09-29（Asia/Shanghai）。使用用户已授权的ERP登录会话，通过页面正常查询和Chrome DevTools Network只读观察完成。未修改ERP商品、映射、人员、采购或成本；未采集/保存Cookie、Token、请求头或原始业务响应。本文件只保留接口结构、字段类型及样本数量。

## 1. 商品档案按平台SKC查询

页面：`https://www.zhuolinkeji.cn/view/system/product/commodityFile.html`。

在“SKU”框填写已确认平台SKC并点击查询，实际请求为GET：

```text
/purchase/product/v1/product-page?composite=1&page=1&limit=100&productNameGroup=&skuGroup=<PLATFORM_SKC>&supplierGroup=&storeId=&createdBy=&specificationAndModel=&synchronizeUnitPrice=&productDeveloper=&testStatus=&englishName=
```

响应HTTP 200：顶层`{code:0,count:4,data:[...4 rows],msg:<string>}`。页面同时显示4个仓库商品，其中一个为共享仓库商品。`itemId`与页面仓库SKU一致，`tradeName`为仓库中文名称。

当前实际加载的`/view/system/product/javascript/productManagement.js`第42–51行配置`product-page?composite=1`、`page:true`、`limit:100`、`limits:[100,200,500,1000]`、`where:{skuGroup}`，查询时重置第一页。分页参数是`page/limit`，不是offset或pageSize。当前目标样本只有4行，因此没有实际跨第二页；多页终止、重复页和漏页需在实现测试中覆盖，不将本次称为真实多页采集通过。

已观察的相关行字段：

| 字段 | 类型/意义 |
| --- | --- |
| itemId | string，仓库SKU |
| tradeName | string，仓库商品名称 |
| picturesLinking | string，仓库图片来源 |
| productColor | string，仓库颜色，不直接当平台属性 |
| specificationAndModel | string，可空，仓库规格 |
| commoditySpecificationAndModel1688 | string，采购规格 |
| proportionOfGoodsPurchased1688 | string，样本格式`1-1`，不能把字段存在即视为所有比例已验证 |
| purchaseSupplierId | string，采购供应商内部关联 |
| supplierData | array，样本长度2；元素含supplierId、supplierName、supplierType、supplierServiceFee、supplierPurchaseUnitPrice、supplierUnitPriceSynchronization |
| commodityBarcodeData | array，元素含barcodeSkcid、barcodeBatchNumber；不包含完整平台SKU对，不能替代下述映射查询 |

其它商品字段包括purchaseUnitPrice、referencePrice等，但本核验不确认其为已采用正式成本，禁止替代采购证据规则。

## 2. 仓库SKU到平台SKC/SKU映射

点击查询结果中共享仓库商品的“映射关系”，打开：

```text
/view/system/product/warehouseMapping.html?productId=<WAREHOUSE_SKU>
```

实际GET请求：

```text
/purchase/product/v1/product-info-sku?productId=<WAREHOUSE_SKU>
```

HTTP 200，响应顶层`{code:0,count:128,data:[...128 rows],msg:<string>}`。当前页面源码配置`page:false`，请求没有page/limit；本样本一次返回全部128行，目标SKC仅匹配1行，证明必须逐行过滤，不能纳入整个仓库数组。仍应核对count与实际数组长度；若未来不一致，标记覆盖不完整，不擅自发明分页参数或宣称全量。

已观察到的平台映射字段（样本均为string）：

| 字段 | 使用意义 |
| --- | --- |
| associatedProductId | 对应仓库SKU，样本与请求productId一致 |
| barcodeSkuid | 平台SKU |
| barcodeSkcid | 平台SKC；精确规范化后筛选目标SKC |
| barcodeAttributeSet | 人类可读的平台属性组合；样本是颜色和规格描述 |
| barcodePrimaryAttribute | 样本为类似标识码的字符串，不应无条件当人类可读属性 |
| barcodeSecondaryAttribute | 可为空 |
| barcodeImageLink、barcodeImageUrl、defaultMainDiagram、compressedPictureLink | 图片字段；本次仅确认字段非空，未证明每个URL可访问/图片内容或优先级 |
| storeId、storeName、platform | 保留来源信息 |
| productSeller、productSellerId | 不参与归属与纳入规则 |
| platformSkuCost | 不能仅凭字段存在升级成正式成本 |

返回结构还含7-daySales、30DaySales等字段。用户已明确销量仅用台账，禁止因此增加ERP销量来源或改变末七天台账口径；本次也未验证这些销售字段准确性或更新周期。

## 3. 核验边界与实施建议

- 两个endpoint及上述请求/响应结构来自本次实际页面网络事件，不是猜测。
- 商品查询按完整已确认SKC，所有仓库结果都需进入映射读取；逐条核验associatedProductId、barcodeSkcid和barcodeSkuid，工作区唯一与冲突规则仍在本机执行。
- 映射数组包含共享仓库的其它商品，只有目标SKC匹配行可纳入；人员不可靠，不额外以其过滤。
- SKU属性可从barcodeAttributeSet取得，采购规格从独立仓库字段读取，两者分开保存。
- 供应商名称可从supplierData取得；1688商品链接仍需沿已验证采购详情采集，本次未验证新的供应商链接接口。
- 没有执行真实ERP改写，没有安装新版扩展，没有将新扩展整条采集/回传/持久化路径称为已通过。实现后仍需对应契约、集成、分页及候选验收。
- 可复制本脱敏结构说明进入执行工作区随0.3.3交付；不要复制原始网络响应、账号资料或业务明细到公开仓库。

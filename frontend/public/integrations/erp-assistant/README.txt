当前 ERP Assistant：8.0.60

唯一源码位于 integrations/erp-assistant-extension/。
桌面版直接加载内置助手；外部 Chrome 用户解压当前 ZIP 后，加载包含 manifest.json 的目录并刷新 ERP。
新建成本任务按完整范围处理，仅异常补查或较大证据按需分段；任务进度与当前工作台一致。
旧版发布副本已从运行资源移除，历史可由 Git 标签追溯；旧协议兼容夹具仅保留在 tools/__fixtures__/。

商品档案支持一键后台获取导出多行表格，复用已取得的对应关系自动补齐资料。文件中的采购单价不写入正式成本。

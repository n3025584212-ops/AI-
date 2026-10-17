# DKQKAR / QCDKR V1.1.0 日志修复版：纯源码小包

包含前端、后端、Electron、构建脚本、配置、测试和必要的界面静态资产。
不包含AI/预测模型权重、运行环境、node_modules、编译产物、EXE或安装包。

请先阅读 [运行与编译说明.md](运行与编译说明.md)。

- 仅编译前端：准备Node/npm与锁定JS依赖后，执行 npm run build。
- 完整运行、预测、AI、测试、生成安装包：先按说明从完整工程恢复外部资源和工具链。
- qcdkr.cmd 保持原代码，需要恢复 toolchain 后使用。

原工程、原完整ZIP和原封存版均保留未动。此包不能直接替代自带运行环境的完整包。
SOURCE_FILE_MANIFEST.json 记录所有源码/静态资产及新增说明的SHA256。
EXTERNAL_RESOURCES_REQUIRED.json 列出需要外部恢复的资源。

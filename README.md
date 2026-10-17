# QCDKR · 冷轧轧制力 AI 预测云平台

AI 大模型与量子机器学习协同驱动的冷轧五机架 S5 轧制力预测系统（v1.1.0）。

## 这是什么

- React 19 + Vite 7 前端，Node 24 后端，Three.js 五机架 UCM 数字孪生
- 25 维工况输入 → 冻结模型 S5 预测 → 误差分析 → 报告导出
- 本地 Ollama `qwen3.5:4b` 工艺助手（Agent + RAG + 语音）
- 60 条 CRD 真实数据回放与证据链快照

## 仓库包含 / 不包含

包含：`src/`、`server/`、`desktop/`、`scripts/`、`tests/`、`docs/`、`public/assets/`、`models/`（冻结模型与元数据）。

不包含（已由 `.gitignore` 排除）：`node_modules/`、`model-runtime/`、`data/local-llm/`、`dist/`、`tmp/`、`.runtime-data/`、`toolchain/`。

## 运行

1. Node.js 24.19+，执行 `npm ci`
2. `npm run build`
3. `node scripts/serve.mjs` → http://127.0.0.1:5189（或双击 `启动.cmd`）
4. 完整预测需要 `models/` 与 `model-runtime/`；AI 助手需要本地 Ollama `qwen3.5:4b`
5. 首次打开需创建本机账号（无默认密码）

## 说明

- 本仓库是源码协作库，不含 5GB 级 Ollama 模型与 Python 运行时；完整离线包见本地交付目录。
- 原始纯源码包说明见 [运行与编译说明.md](运行与编译说明.md)。
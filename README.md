# QCDKR · 冷轧轧制力 AI 预测云平台

面向冷轧五机架 UCM 产线的轧制力预测与工艺分析平台（v1.1.0）。
输入 25 维工况 → 冻结模型 S5 预测 → 误差分析 → 报告导出，配套三维数字孪生与 AI 副驾驶。

> 本仓库只保留**当前云端 Web 版**这一套源码，与线上演示 `http://49.232.27.188:5194` 同源。
> 历史构建产物、桌面版外壳、调试脚本与备份文件不在本仓库内。

## 技术栈

- 前端：React 19 + Vite 7 + Three.js（五机架数字孪生，含 GLB 场景与动态分包）
- 后端：Node.js 24（HTTP 服务 + 任务编排 + 账号与会话）
- 模型：Python 3 运行时（numpy / scikit-learn）加载冻结模型 `models/s5-dkqkar.pkl`
- AI：OpenAI 兼容云端大模型通道 + 本地向量检索（`models/embeddings/bge-small-zh-v1.5`）+ 经验库 + 只读 MCP 工具

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `index.html`、`engineer-preview.html` | Vite 构建入口（主应用 / 角色预览） |
| `vite.config.mjs` | 3D 版构建配置，产物输出 `dist-3d/` |
| `src/` | 前端源码（页面、工作区、三维视图、AI 副驾驶、样式） |
| `server/` | 后端源码（API、模型服务、AI 编排、账号权限、日志与事件） |
| `server/model_runtime.py` | 模型运行时（子进程，按行协议调用） |
| `scripts/` | 启动、构建辅助与 HTTP/UI 验证脚本 |
| `public/` | 静态资源（GLB 模型、预览图、开屏与语音资源、MCP 示例） |
| `models/` | 冻结模型、示例数据与本地向量模型 |
| `mcp/` | 只读 MCP 服务（stdio），供外部工具查询预测、资料与事件 |

## 本地运行

1. 安装 Node.js 24.19+，执行 `npm ci`
2. 构建前端：`npm run build`
3. 启动服务：`npm start` → http://127.0.0.1:5194
4. 首次打开会要求创建本机账号（无默认密码），账号与浏览器指纹绑定
5. 完整预测能力需要 Python 运行时：

```bash
python -m venv model-runtime
model-runtime/bin/pip install -r requirements-model.txt   # Windows: model-runtime\Scripts\pip
```

`model-runtime/`、`node_modules/`、`dist-3d/` 均不入库。

## 环境变量

复制 `.env.example` 为 `.env` 后按需填写（或直接注入进程环境）。常用项：

| 变量 | 作用 |
| --- | --- |
| `QCDKR_3D_PORT` | 服务端口，默认 5194 |
| `QCDKR_HOST` | 监听地址，默认 127.0.0.1；公网部署设 `0.0.0.0` |
| `QCDKR_SHARE_HOSTS` / `QCDKR_SHARE_ORIGINS` | 公网访问白名单（`host:port` 与来源地址） |
| `DKQKAR_LLM_PROVIDER` | AI 通道：`modelscope` / `openai` 等 OpenAI 兼容实现 |
| `DKQKAR_LLM_ENDPOINT` / `DKQKAR_LLM_MODEL` / `DKQKAR_LLM_API_KEY` | 模型地址、模型名与密钥 |
| `DKQKAR_PYTHON` | Python 解释器路径，默认自动探测 `model-runtime/` |
| `QCDKR_SCOPED_STATE` | 设为 `1` 时按账号隔离运行数据 |

## 主要能力

- **预测与复盘**：25 维工况输入、模型版本与哈希校验、误差区间报警、批量与单点预测
- **数字孪生**：五机架 UCM 三维场景，机组状态与预测结果联动
- **AI 副驾驶**：自然语言问工况、参数解释、异常归因；回答带来源与边界说明
- **经验库与事件中心**：问题 + 依据 + 人工确认结果入库，任务终态与异常事件统一播报
- **报告导出**：DOCX / PPTX / CSV，证据链快照可回溯
- **账号体系**：本机账号 + 分发账号，浏览器指纹绑定、会话隔离、操作留痕
- **MCP**：`mcp/qcdkr-mcp` 提供 3 个只读工具（预测 / 资料 / 事件），不含写控制

## 验证

```bash
node scripts/verify-copilot.mjs          # AI 副驾驶链路
node scripts/verify-technician-http.mjs  # 值守技术员接口
node scripts/verify-user-scope.mjs       # 账号隔离
node scripts/verify-multi-account.mjs    # 多账号
```

脚本默认访问本地 `http://127.0.0.1:5194`，需要先 `npm start`。

## 许可与说明

- 仓库不含任何 API Key；`.env` 已在 `.gitignore` 中排除
- 冻结模型与向量模型随仓库提供，仅供本作品演示与评审使用

## 分工与合作

队员 李安甲    前端          8 个界面、参数面板、AI 对话流式渲染、三维数字孪生、首屏动效
队长 刘浩朴    后端与模型    预测链路与接口、QCDKR 模型、8 模型实验、GGUF 与云端热切换、3 个工具编排、权限留痕
队员 王子浩    文档与演示    技术文档、8 张图、演示视频、答辩 PPT、README、提交检查

# QCDKR MCP（只读）

把 QCDKR 的三个只读查询按 **MCP（Model Context Protocol）** 标准暴露给外部 AI 客户端
（Claude Desktop、Cursor、ZCode 等）。独立进程，不改 Web 前端，不碰正式参数。

## 工具

| 工具 | 作用 | 数据来源 |
|---|---|---|
| `get_current_prediction` | 最近一次正式保存的 S5 轧制力预测（含快照 ID、模型版本、输入哈希） | `GET /api/cases` |
| `search_knowledge` | 工艺知识库检索，返回原文片段与出处 | `GET /api/technician/knowledge` |
| `get_incidents` | 事件中心未处理/已恢复事件 | `GET /api/copilot/incidents` |

只读：没有写入、审批、控制设备的工具。所有请求走 QCDKR 账号权限与会话鉴权。

## 前置

- QCDKR Web 正在运行（默认 `http://127.0.0.1:5194`）
- 一个可登录的本机账号

## 安装与自测

```bash
cd mcp/qcdkr-mcp
npm install

# Git Bash：把账号换成你自己的
QCDKR_MCP_USERNAME=rollcraft \
QCDKR_MCP_PASSWORD='你的密码' \
node test-client.mjs
```

预期输出：3 个工具名、4 项检查全 `pass`、`MCP E2E PASS`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `QCDKR_BASE_URL` | `http://127.0.0.1:5194` | QCDKR 地址 |
| `QCDKR_MCP_USERNAME` | 无（必填） | 登录账号 |
| `QCDKR_MCP_PASSWORD` | 无（必填） | 登录密码，只放环境变量，不进仓库 |

## 客户端配置示例

Claude Desktop（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "qcdkr": {
      "command": "node",
      "args": ["D:/Agent/传智杯/_run/full-20261106/QCDKR-Web/mcp/qcdkr-mcp/server.mjs"],
      "env": {
        "QCDKR_BASE_URL": "http://127.0.0.1:5194",
        "QCDKR_MCP_USERNAME": "rollcraft",
        "QCDKR_MCP_PASSWORD": "你的密码"
      }
    }
  }
}
```

Cursor / ZCode 等支持 stdio MCP 的客户端用同样的 `command / args / env` 结构。
Windows 下如 `node` 不在 PATH，把 `command` 换成 `node.exe` 的绝对路径。

## 安全边界

- 只读三工具，无写操作、无设备控制、无参数下发。
- 密码只通过环境变量注入；仓库里没有凭据。
- 工具结果带来源（快照 ID、文档定位、事件 ID），便于核对。
- QCDKR 服务不可达时返回明确错误，不伪造数据。

## 实测（2026-11-16）

`node test-client.mjs`：3 工具全部可调；预测返回 `599.17774 t`、
`snapshot 8b2d23c7-4f59-4283-a609-080171df6647`；知识检索返回 2 条原文；
事件中心可读，未处理 0 条。

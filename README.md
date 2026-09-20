# Dailog

[![license MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![release v1.1.2](https://img.shields.io/badge/release-v1.1.2-blue)](https://github.com/wangyuhao07/Dailog/releases/tag/v1.1.2)

Dailog 是一个本地优先的桌面事项与日报工具。它把事项记录、状态维护、进展补充、AI 日报、区间汇报和本地 Agent 操作放在同一个工作流中。

当前版本：`v1.1.2`

## Dailog 解决什么问题

很多工作记录工具只能保存备忘，日报工具又常常需要用户在一天结束后重新整理。Dailog 让记录和总结连续起来：用户在工作过程中记录事项和状态，软件根据这些真实记录生成日报；熟悉 AI 的用户还可以通过本地 MCP，让 Agent 直接查询和维护 Dailog。

## 产品优势

- **记录与汇报连成一条链**：事项、状态、文本进展、单日日报和区间汇报使用同一份本地数据。
- **界面和 Agent 两种入口**：不使用 AI 的用户可以通过桌面浮窗和控制台完成全部基础操作；习惯对话式工作的用户可以通过 MCP 让本地 Agent 操作事项。
- **以真实记录为依据**：日报和区间汇报会把事项状态与进展作为输入，并结合用户设置的要求和篇幅生成内容。
- **本地优先**：数据使用 SQLite 保存在本机，不需要部署服务器或安装独立数据库服务。
- **可控的 AI 接入**：支持 OpenAI API 兼容接口，用户自行配置接口地址、API Key 和模型名称。
- **数据可迁移**：支持记录数据和全部数据两种 JSON 导出，也支持对应的导入方式。
- **轻量的本地 MCP**：MCP 使用 stdio，不开放网络端口；只有 Dailog 正在运行且设置允许时，本地 Agent 才能访问数据。

## 主要功能

- 桌面浮窗：按月份查看日期卡片，快速新增当天事项。
- 事项状态：支持进行中、停滞、完成和放弃。
- 事项进展：在控制台详情中为事项补充、修改和删除文本进展。
- 控制台：按月份浏览、编辑和管理每日记录。
- 单日日报：根据当天事项、状态、进展和日报要求生成日报。
- 区间汇报：选择日期范围，整合范围内的工作内容生成汇报。
- 自动日报：软件运行期间，到达设置时间后尝试生成当日日报。
- AI 配置：支持 OpenAI API 兼容接口，复杂度可选简单、适中或较长。
- 本地持久化：使用 SQLite 保存应用数据，不需要额外安装数据库服务。
- 数据备份：支持记录导出、全部数据导出、数据导入和全量导入。
- 系统托盘：通过托盘图标打开浮窗或控制台。

## 本地 MCP 与 Agent

Dailog 提供本地 stdio MCP，让支持 MCP 的 Agent 通过对话访问本地事项数据。MCP 不启动网络服务，也不会监听公网端口；Agent 客户端需要调用时，会启动 Dailog 的本地 MCP 子进程。

### 支持的工具

- `dailog_health_check`：检查 Dailog 是否运行、MCP 是否允许访问以及 AI 配置状态。
- `dailog_get_day`：查询某一天的事项、状态、进展和日报。
- `dailog_list_days`：按日期范围查询记录和日报状态。
- `dailog_list_pending_items`：查询近期进行中或停滞的事项。
- `dailog_create_item`：在指定日期新增事项。
- `dailog_update_item_status`：修改事项状态。
- `dailog_add_item_progress`：为事项补充文本进展。
- `dailog_generate_daily_report`：生成或重新生成单日日报。
- `dailog_generate_range_report`：生成指定日期范围的区间汇报。

### 配置方式

1. 启动 Dailog，打开控制台的“设置”。
2. 开启“允许本地 MCP 访问 Dailog 数据”。
3. 点击“复制 MCP 客户端配置”。
4. 将配置粘贴到支持 MCP 的本地 Agent 客户端中。

MCP 配置会根据当前安装目录自动生成。开发环境配置示例：

```json
{
  "mcpServers": {
    "dailog": {
      "command": "<Dailog安装目录>\\node_modules\\electron\\dist\\electron.exe",
      "args": [
        "<Dailog安装目录>\\electron\\mcpNodeServer.js"
      ],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1"
      }
    }
  }
}
```

当 Dailog 退出、MCP 开关关闭或主程序无法访问时，MCP 子进程会拒绝访问并退出。事项转记、周报整理等复杂工作流可以由 Agent 组合上述基础工具完成。

## 快速开始

### 使用 Windows Release

1. 从 [Releases](https://github.com/wangyuhao07/Dailog/releases) 下载 Windows ZIP。
2. 解压到本地目录。
3. 双击其中的 `Dailog.exe`。
4. 软件启动后会显示桌面浮窗，并在系统托盘中保留 Dailog 图标。
5. 右击托盘图标可以打开控制台或退出软件。

### 从源码运行

需要安装 Node.js 22 或更高版本，以及 pnpm：

```bash
pnpm install
pnpm dev
```

Windows 也可以双击：

```text
start-dailog.bat
```

## AI 配置

在控制台的“设置”中填写：

- **接口地址**：OpenAI API 兼容服务的 API 根地址。
- **API Key**：模型服务商提供的访问密钥。
- **模型名称**：服务商支持的模型名称。
- **日报复杂度**：简单、适中或较长，用于控制生成篇幅。
- **日报要求**：可以填写固定栏目，也可以填写自然语言要求，例如“用一段话总结今日工作”。

保存后先使用“测试连接”确认配置可用。日报生成时，Dailog 会把事项、状态和文本进展组装成提示词发送给配置的模型接口，并只保留当天最新一份日报。

## 数据与隐私

- 日常记录和设置保存在本机 SQLite 数据库中，不需要联网同步。
- Dailog 只会在用户主动生成、自动生成时间到达或通过 MCP 调用生成时，向用户配置的模型接口发送必要内容。
- “全部数据导出”和“全量导入”会包含设置项，其中可能包含 API Key，请只在可信位置保存和传输这类文件。
- 仓库不包含用户日报、事项记录、API Key、导出文件或本机数据库。
- MCP 使用本地 stdio，不开放网络端口；是否允许 MCP 访问由设置页开关控制。

## 数据导入导出

| 操作 | 记录数据 | 设置项 |
| --- | --- | --- |
| 记录导出 | 导出 | 不包含 |
| 全部数据导出 | 导出 | 包含 |
| 数据导入 | 覆盖 | 保持不变 |
| 全量导入 | 覆盖 | 完全覆盖 |

导入前建议先导出当前数据。全量导入会同步覆盖本地设置，包括 AI 接口、模型名称和 API Key。

## Windows 打包

构建前端资源：

```bash
pnpm build
```

生成 Windows 应用目录：

```bash
pnpm run dist:dir
```

生成 Windows ZIP：

```bash
pnpm run dist
```

构建结果位于 `release/`。

## 项目结构

```text
electron/
  aiClient.js       AI 请求和响应处理
  main.js           Electron 主进程、托盘和窗口
  mcpServer.js      stdio MCP 工具实现
  mcpNodeServer.js  MCP 子进程入口
  preload.js        安全的渲染进程 API
  storage.js        SQLite 本地持久化
src/
  App.jsx           React 应用界面和交互
  reportPrompt.js   日报和区间汇报提示词组装
  styles.css        界面样式
scripts/
  start-dev.mjs     开发环境启动脚本
```

## 反馈

使用问题或功能建议请提交到 GitHub Issues：

<https://github.com/wangyuhao07/Dailog/issues>

## 开源许可

Dailog 使用 MIT License 开源，详见 [LICENSE](LICENSE)。

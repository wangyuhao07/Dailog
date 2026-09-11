# Dailog

[![license MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![release v1.0.1](https://img.shields.io/badge/release-v1.0.1-blue)](https://github.com/wangyuhao07/Dailog/releases/tag/v1.0.1)

Dailog 是一个本地优先的桌面日报工具。它把日常事项记录、状态维护、单日日报和区间汇报集中在一个 Electron 应用中，适合需要持续记录工作进展的个人用户。

当前版本：`v1.0.1`

## 功能

- 桌面悬浮窗：按月份查看日期卡片，快速新增事项。
- 事项状态：支持进行中、完成、停滞和放弃。
- 控制台：按月份浏览、编辑和管理每日记录。
- 单日日报：根据当天事项、状态、日报要求和篇幅设置生成日报。
- 区间汇报：选择日期范围，汇总区间内的工作事项并生成汇报。
- AI 配置：支持 OpenAI API 兼容接口，可配置接口地址、API Key 和模型名称。
- 自动生成：软件运行期间，到达设置时间后尝试生成当日日报。
- 本地持久化：使用 SQLite 保存应用状态，不需要额外安装数据库服务。
- 数据备份：支持记录导出、全部数据导出、数据导入和全量导入。
- 系统托盘：通过托盘图标打开悬浮窗或控制台。

## 技术栈

- Electron
- React
- Vite
- SQLite
- better-sqlite3

## 开发环境

当前仓库优先面向 Windows 开发和验证。应用使用 Electron 架构，后续可以继续扩展到其他桌面平台。

需要安装：

- Node.js 22 或更高版本
- pnpm

安装依赖：

```bash
pnpm install
```

启动开发版：

```bash
pnpm dev
```

Windows 也可以双击：

```text
start-dailog.bat
```

构建前端资源：

```bash
pnpm build
```

## Windows 打包

生成 Windows 应用目录，用于本地验证：

```bash
pnpm run dist:dir
```

生成 Windows 解压即用版：

```bash
pnpm run dist
```

生成结果位于 `release/`。解压 zip 后运行其中的 `Dailog.exe` 即可。

## AI 配置

在控制台的设置页填写：

- 接口地址：OpenAI API 兼容服务的 API 根地址。
- API Key：对应服务商提供的访问密钥。
- 模型名称：服务商支持的模型名称。
- 日报复杂度：简单、适中或较长。
- 日报要求：可以填写固定栏目，也可以填写自然语言生成要求。

配置完成后，可以使用“测试连接”确认接口返回格式是否兼容。日报和区间汇报会把事项及其状态作为输入，并遵守设置页中的日报要求。

## 数据与安全

- 日常记录和设置保存在本机 SQLite 数据库中，不需要联网同步。
- Dailog 只会在用户主动配置并发起 AI 请求时，将生成所需内容发送到配置的模型接口。
- “全部数据导出”和“全量导入”会包含设置项，其中可能包含 API Key。请只在可信位置保存或传输这类文件。
- 导出的 `dailog-*.json`、SQLite 数据库文件和运行日志不会被提交到 Git。
- 仓库不包含用户日报、事项记录、API Key、导出文件或本机数据库。

## 数据导入导出

| 操作 | 记录 | 设置 |
| --- | --- | --- |
| 记录导出 | 导出 | 不包含 |
| 全部数据导出 | 导出 | 包含 |
| 数据导入 | 覆盖 | 保持不变 |
| 全量导入 | 覆盖 | 完全覆盖 |

导入前建议先导出当前数据。导入操作会覆盖对应范围内的本地内容。

## 项目结构

```text
electron/
  aiClient.js       AI 请求和响应处理
  main.js           Electron 主进程、托盘和窗口
  preload.js        安全的渲染进程 API
  storage.js        SQLite 本地持久化
src/
  App.jsx           React 应用界面和交互
  prototypeData.js  日期和记录数据处理
  reportPrompt.js   日报和区间汇报提示词组装
  styles.css        界面样式
scripts/
  start-dev.mjs     开发环境启动脚本
```

## 反馈

使用问题或功能建议请提交到 GitHub：

<https://github.com/wangyuhao07/Dailog/issues>

## 开源许可

Dailog 使用 MIT License 开源，详见 [LICENSE](LICENSE)。

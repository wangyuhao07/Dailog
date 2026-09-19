import { createStorage } from './storage.js';
import { generateDailyReport } from './aiClient.js';
import { isMainRuntimeActive } from './core/runtimeGuard.js';
import {
  addItemProgress,
  collectRangeDays,
  createItem,
  findDay,
  isIsoDate,
  listDays,
  listPendingItems,
  saveDailyReport,
  saveRangeReport,
  updateItem,
} from './core/recordService.js';
import { buildDailyReportPrompt, buildRangeReportPrompt } from './core/reportPrompt.js';
import fs from 'node:fs';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'dailog-mcp-server';
const ITEM_STATUSES = ['进行中', '停滞', '完成', '放弃'];
const DEFAULT_RESPONSE_FORMAT = 'markdown';

const TOOL_DEFINITIONS = [
  {
    name: 'dailog_health_check',
    title: 'Dailog Health Check',
    description: 'Check whether Dailog MCP can access local data and whether AI settings are configured.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'dailog_get_day',
    title: 'Get Dailog Day',
    description: 'Read one date from Dailog, including items, statuses, progress notes, and the daily report if it exists.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date to read in YYYY-MM-DD format, for example 2026-09-10.',
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Response text format. Defaults to markdown.',
        },
      },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'dailog_list_days',
    title: 'List Dailog Days',
    description: 'List Dailog dates in a date range, with item counts, report status, and optional item details.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Optional inclusive start date in YYYY-MM-DD format.',
        },
        end_date: {
          type: 'string',
          description: 'Optional inclusive end date in YYYY-MM-DD format.',
        },
        status: {
          type: 'string',
          enum: ITEM_STATUSES,
          description: 'Optional item status filter.',
        },
        include_items: {
          type: 'boolean',
          description: 'Whether to include item details. Defaults to false.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of days to return, from 1 to 100. Defaults to 30.',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset. Defaults to 0.',
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Response text format. Defaults to markdown.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'dailog_list_pending_items',
    title: 'List Dailog Pending Items',
    description: 'List unfinished Dailog items from recent recorded days. Defaults to statuses 进行中 and 停滞.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'How many recent recorded days to scan, from 1 to 90. Defaults to 30.',
        },
        statuses: {
          type: 'array',
          items: {
            type: 'string',
            enum: ITEM_STATUSES,
          },
          description: 'Statuses to include. Defaults to 进行中 and 停滞.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return, from 1 to 100. Defaults to 50.',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset. Defaults to 0.',
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Response text format. Defaults to markdown.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'dailog_create_item',
    title: 'Create Dailog Item',
    description: 'Create one work item on a Dailog date. New items default to 进行中 unless a valid status is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date for the item in YYYY-MM-DD format.',
        },
        text: {
          type: 'string',
          description: 'The work item text. It cannot be empty.',
        },
        status: {
          type: 'string',
          enum: ITEM_STATUSES,
          description: 'Optional item status. Defaults to 进行中.',
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Response text format. Defaults to markdown.',
        },
      },
      required: ['date', 'text'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'dailog_update_item_status',
    title: 'Update Dailog Item Status',
    description: 'Change the status of one existing Dailog work item.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date containing the item in YYYY-MM-DD format.',
        },
        item_id: {
          type: 'string',
          description: 'The item ID returned by Dailog queries or dailog_create_item.',
        },
        status: {
          type: 'string',
          enum: ITEM_STATUSES,
          description: 'New item status.',
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Response text format. Defaults to markdown.',
        },
      },
      required: ['date', 'item_id', 'status'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'dailog_add_item_progress',
    title: 'Add Dailog Item Progress',
    description: 'Append a text-only progress note to one existing Dailog work item.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date containing the item in YYYY-MM-DD format.',
        },
        item_id: {
          type: 'string',
          description: 'The item ID returned by Dailog queries or dailog_create_item.',
        },
        text: {
          type: 'string',
          description: 'Progress note text. It cannot be empty.',
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Response text format. Defaults to markdown.',
        },
      },
      required: ['date', 'item_id', 'text'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'dailog_generate_daily_report',
    title: 'Generate Dailog Daily Report',
    description: 'Generate or regenerate the report for one recorded Dailog date using the configured OpenAI-compatible model, template, and complexity.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date to report in YYYY-MM-DD format.',
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Response text format. Defaults to markdown.',
        },
      },
      required: ['date'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'dailog_generate_range_report',
    title: 'Generate Dailog Range Report',
    description: 'Generate or regenerate a report for an inclusive date range using all recorded items and progress notes in that range.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Inclusive range start date in YYYY-MM-DD format.',
        },
        end_date: {
          type: 'string',
          description: 'Inclusive range end date in YYYY-MM-DD format.',
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Response text format. Defaults to markdown.',
        },
      },
      required: ['start_date', 'end_date'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
].map((tool) => ({
  ...tool,
  annotations: tool.annotations ?? {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}));

function encodeJsonLineMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

function encodeContentLengthMessage(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function makeError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

function countDays(months) {
  return (Array.isArray(months) ? months : []).reduce(
    (total, month) => total + (Array.isArray(month?.dayCards) ? month.dayCards.length : 0),
    0,
  );
}

function getHealthPayload({ state, version }) {
  const settings = state?.settings ?? {};
  const aiConfigured = Boolean(
    String(settings.endpoint || '').trim() &&
      String(settings.apiKey || '').trim() &&
      String(settings.model || '').trim(),
  );

  return {
    app: 'Dailog',
    version,
    mcpEnabled: Boolean(settings.mcpEnabled),
    database: {
      readable: true,
      writable: true,
    },
    data: {
      monthCount: Array.isArray(state?.months) ? state.months.length : 0,
      dayCount: countDays(state?.months),
    },
    ai: {
      configured: aiConfigured,
      endpointConfigured: Boolean(String(settings.endpoint || '').trim()),
      apiKeyConfigured: Boolean(String(settings.apiKey || '').trim()),
      model: String(settings.model || '').trim() || null,
    },
  };
}

function formatHealthMarkdown(payload) {
  return [
    '# Dailog MCP Health Check',
    '',
    `- App: ${payload.app} v${payload.version}`,
    `- MCP: ${payload.mcpEnabled ? 'enabled' : 'disabled'}`,
    `- Database: ${payload.database.readable && payload.database.writable ? 'readable and writable' : 'unavailable'}`,
    `- Data: ${payload.data.monthCount} months, ${payload.data.dayCount} days`,
    `- AI: ${payload.ai.configured ? `configured (${payload.ai.model})` : 'not fully configured'}`,
  ].join('\n');
}

function normalizeResponseFormat(value) {
  return value === 'json' ? 'json' : DEFAULT_RESPONSE_FORMAT;
}

function normalizeLimit(value, defaultValue = 30) {
  return Math.max(1, Math.min(100, Number(value) || defaultValue));
}

function normalizeOffset(value) {
  return Math.max(0, Number(value) || 0);
}

function assertIsoDate(value, fieldName) {
  if (value !== undefined && value !== null && !isIsoDate(String(value))) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD date.`);
  }
}

function requireIsoDate(value, fieldName) {
  assertIsoDate(value, fieldName);
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${fieldName} is required.`);
  }

  return String(value);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function cleanItem(item) {
  return {
    id: item.id,
    text: item.text,
    status: item.status,
    subtasks: Array.isArray(item.subtasks) ? item.subtasks.map((subtask) => ({ id: subtask.id, text: subtask.text })) : [],
  };
}

function summarizeItems(items) {
  const summary = Object.fromEntries(ITEM_STATUSES.map((status) => [status, 0]));
  for (const item of Array.isArray(items) ? items : []) {
    summary[item.status] = (summary[item.status] ?? 0) + 1;
  }
  return summary;
}

function cleanDay(day) {
  if (!day) {
    return null;
  }

  const items = Array.isArray(day.items) ? day.items.map(cleanItem) : [];
  return {
    date: day.date,
    weekday: day.weekday || '',
    reportReady: Boolean(day.reportReady || String(day.reportText || '').trim()),
    reportText: String(day.reportText || ''),
    itemCount: items.length,
    itemStatusSummary: summarizeItems(items),
    items,
  };
}

function daySummary(day, includeItems = false) {
  const clean = cleanDay(day);
  return {
    date: clean.date,
    weekday: clean.weekday,
    reportReady: clean.reportReady,
    itemCount: clean.itemCount,
    itemStatusSummary: clean.itemStatusSummary,
    ...(includeItems ? { items: clean.items } : {}),
  };
}

function makeToolResult({ markdown, structuredContent, responseFormat }) {
  const text = normalizeResponseFormat(responseFormat) === 'json'
    ? JSON.stringify(structuredContent, null, 2)
    : markdown;

  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    structuredContent,
  };
}

function makeToolError(message, suggestion) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: suggestion ? `${message}\n\n建议：${suggestion}` : message,
      },
    ],
    structuredContent: {
      ok: false,
      message,
      suggestion: suggestion || null,
    },
  };
}

function formatItemMarkdown(item, index) {
  const lines = [`${index + 1}. [${item.status}] ${item.text}`];
  for (const subtask of item.subtasks ?? []) {
    lines.push(`   - 进展：${subtask.text}`);
  }
  return lines.join('\n');
}

function formatDayMarkdown(payload) {
  if (!payload.exists) {
    return `# ${payload.date}\n\n这一天没有 Dailog 记录。`;
  }

  const day = payload.day;
  const lines = [
    `# ${day.date} ${day.weekday}`,
    '',
    `- 事项数量：${day.itemCount}`,
    `- 日报：${day.reportReady ? '已生成' : '未生成'}`,
    '',
    '## 事项',
  ];

  if (day.items.length) {
    lines.push(...day.items.map(formatItemMarkdown));
  } else {
    lines.push('无事项。');
  }

  if (day.reportText) {
    lines.push('', '## 当日日报', day.reportText);
  }

  return lines.join('\n');
}

function formatListDaysMarkdown(payload) {
  const lines = [
    '# Dailog 日期记录',
    '',
    `- 总数：${payload.total_count}`,
    `- 本次返回：${payload.count}`,
    `- offset：${payload.offset}`,
  ];

  if (!payload.days.length) {
    lines.push('', '没有找到符合条件的日期记录。');
    return lines.join('\n');
  }

  lines.push('');
  for (const day of payload.days) {
    lines.push(`## ${day.date} ${day.weekday}`);
    lines.push(`- 事项数量：${day.itemCount}`);
    lines.push(`- 日报：${day.reportReady ? '已生成' : '未生成'}`);
    if (day.items?.length) {
      lines.push(...day.items.map(formatItemMarkdown));
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function formatPendingItemsMarkdown(payload) {
  const lines = [
    '# Dailog 未完成事项',
    '',
    `- 总数：${payload.total_count}`,
    `- 本次返回：${payload.count}`,
    `- offset：${payload.offset}`,
  ];

  if (!payload.items.length) {
    lines.push('', '没有找到符合条件的未完成事项。');
    return lines.join('\n');
  }

  lines.push('');
  payload.items.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.date} ${entry.weekday} [${entry.item.status}] ${entry.item.text}`);
    for (const subtask of entry.item.subtasks ?? []) {
      lines.push(`   - 进展：${subtask.text}`);
    }
  });

  return lines.join('\n');
}

function formatMutationMarkdown(payload, title) {
  const lines = [`# ${title}`, '', `- 日期：${payload.date}`];
  if (payload.item) {
    lines.push(`- 事项 ID：${payload.item.id}`, `- 事项：${payload.item.text}`, `- 状态：${payload.item.status}`);
  }
  if (payload.subtask) {
    lines.push(`- 进展：${payload.subtask.text}`);
  }
  lines.push('', '## 更新后的日期记录');
  if (payload.day) {
    lines.push(...payload.day.items.map(formatItemMarkdown));
    if (!payload.day.items.length) {
      lines.push('无事项。');
    }
  } else {
    lines.push('无事项。');
  }

  return lines.join('\n');
}

function formatReportMarkdown(payload, title) {
  const lines = [`# ${title}`, ''];
  if (payload.date) {
    lines.push(`- 日期：${payload.date}`);
  }
  if (payload.rangeStart) {
    lines.push(`- 区间：${payload.rangeStart} 至 ${payload.rangeEnd}`);
  }
  if (payload.title) {
    lines.push(`- 名称：${payload.title}`);
  }
  if (payload.reportText) {
    lines.push('', '## 汇报内容', payload.reportText);
  }
  return lines.join('\n');
}

function formatCurrentTimeLabel() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function createDebugEntry(title, status, request, response) {
  return {
    id: `debug-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: formatCurrentTimeLabel(),
    title,
    status,
    request,
    response,
  };
}

export class McpStdioTransport {
  constructor({ storage, version, canAccess, onClose }) {
    this.storage = storage;
    this.version = version;
    this.canAccess = canAccess;
    this.onClose = onClose;
    this.buffer = Buffer.alloc(0);
    this.responseMode = 'content-length';
  }

  start() {
    process.stdin.on('data', (chunk) => this.consume(chunk));
    process.stdin.on('end', () => this.close());
    process.stdin.resume();
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length) {
      if (this.consumeContentLengthMessage()) {
        continue;
      }

      if (this.consumeJsonLineMessage()) {
        continue;
      }

      return;
    }
  }

  consumeContentLengthMessage() {
    const prefix = this.buffer.slice(0, Math.min(this.buffer.length, 32)).toString('utf8');
    if (!/^Content-Length:/i.test(prefix)) {
      return false;
    }

    const separator = Buffer.from('\r\n\r\n');
    const separatorIndex = this.buffer.indexOf(separator);
    if (separatorIndex === -1) {
      return false;
    }

    const header = this.buffer.slice(0, separatorIndex).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      this.close();
      return true;
    }

    const contentLength = Number(match[1]);
    const messageStart = separatorIndex + separator.length;
    const messageEnd = messageStart + contentLength;
    if (this.buffer.length < messageEnd) {
      return false;
    }

    const rawMessage = this.buffer.slice(messageStart, messageEnd).toString('utf8');
    this.buffer = this.buffer.slice(messageEnd);
    this.responseMode = 'content-length';
    this.handleRawMessage(rawMessage, 'content-length');
    return true;
  }

  consumeJsonLineMessage() {
    const lineEnd = this.buffer.indexOf(Buffer.from('\n'));
    if (lineEnd === -1) {
      return false;
    }

    const rawMessage = this.buffer.slice(0, lineEnd).toString('utf8').trim();
    this.buffer = this.buffer.slice(lineEnd + 1);
    if (!rawMessage) {
      return true;
    }

    this.responseMode = 'json-line';
    this.handleRawMessage(rawMessage, 'json-line');
    return true;
  }

  send(message, mode = this.responseMode) {
    fs.writeSync(1, mode === 'json-line' ? encodeJsonLineMessage(message) : encodeContentLengthMessage(message));
  }

  handleRawMessage(rawMessage, mode) {
    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      this.send(makeError(null, -32700, 'Parse error'), mode);
      return;
    }

    if (!message || typeof message !== 'object') {
      this.send(makeError(null, -32600, 'Invalid request'), mode);
      return;
    }

    if (message.id === undefined) {
      if (message.method === 'exit') {
        this.close();
      }
      return;
    }

    this.handleRequest(message)
      .then((result) => {
        if (result !== undefined) {
          this.send({ jsonrpc: '2.0', id: message.id, result }, mode);
        }
      })
      .catch((error) => {
        this.send(makeError(message.id, -32603, error?.message || 'Internal error'), mode);
      });
  }

  async handleRequest(message) {
    if (this.canAccess && !this.canAccess()) {
      throw new Error('Dailog 主程序未运行，或本地 MCP 访问已关闭。');
    }

    switch (message.method) {
      case 'initialize':
        return {
          protocolVersion: message.params?.protocolVersion || MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: SERVER_NAME,
            version: this.version,
          },
        };

      case 'ping':
        return {};

      case 'tools/list':
        return {
          tools: TOOL_DEFINITIONS,
        };

      case 'tools/call':
        return this.callTool(message.params);

      default:
        throw new Error(`Unsupported MCP method: ${message.method}`);
    }
  }

  async callTool(params) {
    const name = params?.name;
    const args = params?.arguments ?? {};

    try {
      switch (name) {
        case 'dailog_health_check':
          return this.callHealthCheck(args);
        case 'dailog_get_day':
          return this.callGetDay(args);
        case 'dailog_list_days':
          return this.callListDays(args);
        case 'dailog_list_pending_items':
          return this.callListPendingItems(args);
        case 'dailog_create_item':
          return this.callCreateItem(args);
        case 'dailog_update_item_status':
          return this.callUpdateItemStatus(args);
        case 'dailog_add_item_progress':
          return this.callAddItemProgress(args);
        case 'dailog_generate_daily_report':
          return await this.callGenerateDailyReport(args);
        case 'dailog_generate_range_report':
          return await this.callGenerateRangeReport(args);
        default:
          throw new Error(`Unknown tool: ${name || 'empty'}`);
      }
    } catch (error) {
      return makeToolError(error?.message || 'Tool call failed.', '请检查工具入参是否符合 schema，然后重试。');
    }
  }

  callHealthCheck(args = {}) {
    const state = this.storage.readState();
    const payload = getHealthPayload({ state, version: this.version });
    return makeToolResult({
      markdown: formatHealthMarkdown(payload),
      structuredContent: payload,
      responseFormat: args.response_format,
    });
  }

  callGetDay(args = {}) {
    assertIsoDate(args.date, 'date');
    const state = this.storage.readState();
    const found = findDay(state?.months ?? [], String(args.date));
    const payload = {
      ok: true,
      exists: Boolean(found?.day),
      date: String(args.date),
      day: cleanDay(found?.day),
    };

    return makeToolResult({
      markdown: formatDayMarkdown(payload),
      structuredContent: payload,
      responseFormat: args.response_format,
    });
  }

  callListDays(args = {}) {
    assertIsoDate(args.start_date, 'start_date');
    assertIsoDate(args.end_date, 'end_date');
    if (args.start_date && args.end_date && String(args.start_date) > String(args.end_date)) {
      throw new Error('start_date must be earlier than or equal to end_date.');
    }

    const includeItems = Boolean(args.include_items);
    const state = this.storage.readState();
    const result = listDays(state?.months ?? [], {
      startDate: args.start_date ? String(args.start_date) : undefined,
      endDate: args.end_date ? String(args.end_date) : undefined,
      status: args.status ? String(args.status) : '',
      limit: normalizeLimit(args.limit, 30),
      offset: normalizeOffset(args.offset),
    });
    const payload = {
      ok: true,
      total_count: result.total_count,
      count: result.count,
      offset: result.offset,
      has_more: result.has_more,
      next_offset: result.next_offset,
      days: result.days.map((day) => daySummary(day, includeItems)),
    };

    return makeToolResult({
      markdown: formatListDaysMarkdown(payload),
      structuredContent: payload,
      responseFormat: args.response_format,
    });
  }

  callListPendingItems(args = {}) {
    const statuses = Array.isArray(args.statuses) && args.statuses.length
      ? args.statuses.map(String)
      : ['进行中', '停滞'];
    const limit = normalizeLimit(args.limit, 50);
    const offset = normalizeOffset(args.offset);
    const state = this.storage.readState();
    const allItems = listPendingItems(state?.months ?? [], {
      days: Math.max(1, Math.min(90, Number(args.days) || 30)),
      statuses,
    }).map((entry) => ({
      date: entry.date,
      weekday: entry.weekday || '',
      item: cleanItem(entry.item),
    }));
    const items = allItems.slice(offset, offset + limit);
    const payload = {
      ok: true,
      total_count: allItems.length,
      count: items.length,
      offset,
      has_more: offset + items.length < allItems.length,
      next_offset: offset + items.length < allItems.length ? offset + items.length : null,
      statuses,
      days: Math.max(1, Math.min(90, Number(args.days) || 30)),
      items,
    };

    return makeToolResult({
      markdown: formatPendingItemsMarkdown(payload),
      structuredContent: payload,
      responseFormat: args.response_format,
    });
  }

  persistMonths(nextMonths) {
    const state = this.storage.readState() ?? {
      months: [],
      settings: null,
      aiDebugEntries: [],
    };

    return this.storage.writeState({
      ...state,
      months: nextMonths,
    });
  }

  persistState(nextState) {
    return this.storage.writeState(nextState);
  }

  persistDebugEntry(state, entry, months = state.months) {
    return this.persistState({
      ...state,
      months,
      aiDebugEntries: [entry, ...(Array.isArray(state.aiDebugEntries) ? state.aiDebugEntries : [])].slice(0, 8),
    });
  }

  buildMutationPayload(date, state, result, subtask = null) {
    const found = findDay(state?.months ?? [], date);
    const item = result.item ?? null;
    return {
      ok: true,
      date,
      ...(item ? { item: cleanItem(item) } : {}),
      ...(subtask ? { subtask: { id: subtask.id, text: subtask.text } } : {}),
      day: cleanDay(found?.day),
    };
  }

  callCreateItem(args = {}) {
    const date = requireIsoDate(args.date, 'date');
    const text = requireText(args.text, 'text');
    const state = this.storage.readState() ?? { months: [], settings: null, aiDebugEntries: [] };
    const result = createItem(state.months ?? [], {
      date,
      text,
      status: args.status || '进行中',
    });
    const savedState = this.persistMonths(result.months);
    const payload = this.buildMutationPayload(date, savedState, result);

    return makeToolResult({
      markdown: formatMutationMarkdown(payload, 'Dailog 新增事项'),
      structuredContent: payload,
      responseFormat: args.response_format,
    });
  }

  callUpdateItemStatus(args = {}) {
    const date = requireIsoDate(args.date, 'date');
    const itemId = requireText(args.item_id, 'item_id');
    const status = requireText(args.status, 'status');
    const state = this.storage.readState() ?? { months: [], settings: null, aiDebugEntries: [] };
    const result = updateItem(state.months ?? [], { date, itemId, status });
    const savedState = this.persistMonths(result.months);
    const payload = this.buildMutationPayload(date, savedState, result);

    return makeToolResult({
      markdown: formatMutationMarkdown(payload, 'Dailog 更新事项状态'),
      structuredContent: payload,
      responseFormat: args.response_format,
    });
  }

  callAddItemProgress(args = {}) {
    const date = requireIsoDate(args.date, 'date');
    const itemId = requireText(args.item_id, 'item_id');
    const text = requireText(args.text, 'text');
    const state = this.storage.readState() ?? { months: [], settings: null, aiDebugEntries: [] };
    const result = addItemProgress(state.months ?? [], { date, itemId, text });
    const savedState = this.persistMonths(result.months);
    const payload = this.buildMutationPayload(date, savedState, result, result.subtask);
    payload.item = cleanItem(findDay(savedState.months, date)?.day?.items?.find((item) => item.id === itemId));

    return makeToolResult({
      markdown: formatMutationMarkdown(payload, 'Dailog 添加事项进展'),
      structuredContent: payload,
      responseFormat: args.response_format,
    });
  }

  async callGenerateDailyReport(args = {}) {
    const date = requireIsoDate(args.date, 'date');
    const state = this.storage.readState() ?? { months: [], settings: null, aiDebugEntries: [] };
    const found = findDay(state.months ?? [], date);
    const items = found?.day?.items?.filter((item) => String(item?.text || '').trim()) ?? [];
    if (!found?.day || !items.length) {
      throw new Error('日报生成失败：当天没有事项记录。');
    }

    const settings = state.settings ?? {};
    const day = { ...found.day, items };
    const prompt = buildDailyReportPrompt({ day, settings });
    const result = await generateDailyReport(
      {
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
      },
      prompt,
    );
    const response = result?.message || (result?.ok ? '日报已生成。' : '日报生成失败。');
    const debugEntry = createDebugEntry('MCP 生成日报', result?.ok ? 'success' : 'error', prompt, response);

    if (!result?.ok) {
      this.persistDebugEntry(state, debugEntry);
      return makeToolError(response, '请检查 Dailog 设置中的接口地址、API Key 和模型名称。');
    }

    const saved = saveDailyReport(state.months ?? [], { date, reportText: response });
    const savedState = this.persistDebugEntry(state, debugEntry, saved.months);
    const payload = {
      ok: true,
      date,
      reportReady: true,
      reportText: response,
      day: cleanDay(findDay(savedState.months, date)?.day),
    };

    return makeToolResult({
      markdown: formatReportMarkdown(payload, 'Dailog 单日日报'),
      structuredContent: payload,
      responseFormat: args.response_format,
    });
  }

  async callGenerateRangeReport(args = {}) {
    const rangeStart = requireIsoDate(args.start_date, 'start_date');
    const rangeEnd = requireIsoDate(args.end_date, 'end_date');
    if (rangeStart > rangeEnd) {
      throw new Error('start_date must be earlier than or equal to end_date.');
    }

    const rangeLength = Math.round((Date.parse(`${rangeEnd}T12:00:00`) - Date.parse(`${rangeStart}T12:00:00`)) / 86400000) + 1;
    if (rangeLength > 366) {
      throw new Error('区间汇报一次最多支持 366 天，请缩小日期范围后重试。');
    }

    const state = this.storage.readState() ?? { months: [], settings: null, aiDebugEntries: [] };
    const collected = collectRangeDays(state.months ?? [], { startDate: rangeStart, endDate: rangeEnd });
    if (!collected.totalItems) {
      throw new Error('区间汇报生成失败：选中区间没有事项记录。');
    }

    const settings = state.settings ?? {};
    const prompt = buildRangeReportPrompt({
      rangeStart,
      rangeEnd,
      days: collected.days,
      settings,
    });
    const result = await generateDailyReport(
      {
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
      },
      prompt,
    );
    const response = result?.message || (result?.ok ? '区间汇报已生成。' : '区间汇报生成失败。');
    const debugEntry = createDebugEntry('MCP 生成区间汇报', result?.ok ? 'success' : 'error', prompt, response);

    if (!result?.ok) {
      this.persistDebugEntry(state, debugEntry);
      return makeToolError(response, '请检查 Dailog 设置中的接口地址、API Key 和模型名称。');
    }

    const saved = saveRangeReport(state.months ?? [], {
      rangeStart,
      rangeEnd,
      reportText: response,
      note: `${collected.coveredDays} 天 / ${collected.totalItems} 条事项`,
    });
    const savedState = this.persistDebugEntry(state, debugEntry, saved.months);
    const payload = {
      ok: true,
      rangeStart,
      rangeEnd,
      title: saved.report.title,
      note: saved.report.note,
      reportText: saved.report.reportText,
      report: saved.report,
      coveredDays: collected.coveredDays,
      totalItems: collected.totalItems,
      monthKey: rangeStart.slice(0, 7),
      saved: Boolean(savedState),
    };

    return makeToolResult({
      markdown: formatReportMarkdown(payload, 'Dailog 区间汇报'),
      structuredContent: payload,
      responseFormat: args.response_format,
    });
  }

  close() {
    this.onClose?.();
  }
}

export async function runMcpServer({ app, version }) {
  await app.whenReady();

  if (!isMainRuntimeActive(app.getPath('userData'))) {
    fs.writeSync(2, 'Dailog 主程序未运行。请先启动 Dailog，再使用本地 MCP。\n');
    app.exit(0);
    return;
  }

  const storage = createStorage(app.getPath('userData'));
  if (!isMcpEnabled(storage)) {
    storage.close();
    fs.writeSync(2, 'Dailog MCP 未启用。请在 Dailog 设置页开启“允许本地 MCP 访问 Dailog 数据”。\n');
    app.exit(0);
    return;
  }

  startMcpServer({
    storage,
    version,
    canAccess: () => isMainRuntimeActive(app.getPath('userData')) && isMcpEnabled(storage),
    onClose: () => app.exit(0),
  });
}

export function isMcpEnabled(storage) {
  return Boolean(storage.readState()?.settings?.mcpEnabled);
}

export function startMcpServer({ storage, version, canAccess, onClose }) {
  const transport = new McpStdioTransport({
    storage,
    version,
    canAccess,
    onClose() {
      storage.close();
      onClose?.();
    },
  });
  transport.start();
}

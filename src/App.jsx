import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCalendarRows,
  cloneMonths,
  createMonth,
  formatDateLabel,
  makeBlankDay,
  monthTitle,
  parseMonthLabel,
  shiftMonthKey,
  sortMonths,
} from './prototypeData';
import { buildDailyReportPrompt, buildRangeReportPrompt } from './reportPrompt';

const TASK_ROW_HEIGHT = 34;
const TASK_ROW_GAP = 7;
const TASK_SCROLL_PADDING = 19;
const DAILY_HEAD_HEIGHT = 40;
const DAILY_FOOTER_HEIGHT = 26;
const COMPOSER_HEIGHT = 160;
const COMPOSER_GAP = 10;
const MAX_VISIBLE_TASKS = 4;
const MAX_VISIBLE_DATE_ITEMS = 3;
const DEFAULT_REPORT_TEXT = '这里显示当天最新一版日报。后续接入 AI 后，多次生成只保留最新内容。';
const DEFAULT_SETTINGS = {
  opacity: 88,
  reportTime: '18:30',
  endpoint: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  complexity: '适中',
  template: '今日完成：\n进行中：\n风险与阻塞：\n明日计划：',
  showApiKey: false,
  aiDebugEnabled: true,
  aiDebugPrompt: '你是什么模型？',
};
const GITHUB_URL = 'https://github.com/wangyuhao07/Dailog';
const APP_VERSION = '1.0.1';
const APP_AUTHOR = '王肉肉的白日梦';
const COMPLEXITY_OPTIONS = ['简单', '适中', '较长'];
const EXPORT_SCHEMA_VERSION = 1;
const EXPORT_APP_NAME = 'Dailog';

function normalizeSettings(settings) {
  const nextSettings = {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
  };

  return {
    ...nextSettings,
    opacity: Math.max(30, Math.min(100, Number(nextSettings.opacity) || DEFAULT_SETTINGS.opacity)),
    apiKey: typeof nextSettings.apiKey === 'string' ? nextSettings.apiKey : '',
    complexity: nextSettings.complexity === '复杂' ? '较长' : nextSettings.complexity,
    showApiKey: Boolean(nextSettings.showApiKey),
    aiDebugEnabled: nextSettings.aiDebugEnabled !== false,
    aiDebugPrompt: typeof nextSettings.aiDebugPrompt === 'string' ? nextSettings.aiDebugPrompt : DEFAULT_SETTINGS.aiDebugPrompt,
  };
}

function normalizeAiDebugEntries(entries) {
  return Array.isArray(entries) ? entries.filter(Boolean).slice(0, 8) : [];
}

function buildExportPayload(exportType, { months, settings }) {
  const payload = {
    app: EXPORT_APP_NAME,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportType,
    exportedAt: new Date().toISOString(),
    data: {
      months: sortMonths(months),
    },
  };

  if (exportType === 'full') {
    payload.data.settings = normalizeSettings(settings);
  }

  return payload;
}

function exportFileName(exportType) {
  return `dailog-${exportType}-${new Date().toISOString().slice(0, 10)}.json`;
}

function downloadJsonInBrowser(exportType, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName(exportType);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importJsonInBrowser() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener(
      'change',
      async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve({ ok: false, canceled: true, message: '已取消导入。' });
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          resolve({ ok: false, message: '导入失败：文件超过 10MB，请确认是否为 Dailog 导出文件。' });
          return;
        }

        try {
          const text = await file.text();
          resolve({ ok: true, filePath: file.name, payload: JSON.parse(text) });
        } catch {
          resolve({ ok: false, message: '导入失败：JSON 文件格式不正确。' });
        }
      },
      { once: true },
    );

    input.click();
  });
}

function readImportPayload(payload, importType) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('导入失败：文件内容不是有效的 Dailog 数据。');
  }
  if (payload.app !== EXPORT_APP_NAME) {
    throw new Error('导入失败：这不是 Dailog 导出的数据文件。');
  }
  if (Number(payload.schemaVersion) > EXPORT_SCHEMA_VERSION) {
    throw new Error('导入失败：文件版本高于当前软件支持的版本。');
  }

  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('导入失败：文件缺少数据内容。');
  }
  if (!Array.isArray(data.months)) {
    throw new Error('导入失败：文件缺少记录数据。');
  }

  const nextState = {
    months: sortMonths(data.months),
    settings: null,
  };

  if (importType === 'full') {
    if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
      throw new Error('导入失败：全量导入文件缺少设置数据。');
    }
    nextState.settings = normalizeSettings(data.settings);
  }

  return nextState;
}

function buildChatCompletionsUrl(endpoint) {
  const base = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('请先填写接口地址。');
  }

  const parsed = new URL(base);

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('接口地址必须以 http:// 或 https:// 开头。');
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/chat/completions')) {
    parsed.pathname = `${pathname}/chat/completions`.replace(/\/{2,}/g, '/');
  }

  return parsed.toString();
}

async function readResponsePayload(response) {
  const text = await response.text();
  if (!text) {
    return { text: '', json: null };
  }

  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

function localizeProviderError(detail) {
  const raw = String(detail || '').trim();
  if (!raw) {
    return '';
  }

  const rules = [
    {
      pattern: /(invalid|incorrect).*(api key|token)|api key.*(invalid|incorrect)|unauthorized|authentication/i,
      message: 'API Key 不正确，请检查是否复制完整，或是否使用了对应服务商的 Key。',
    },
    {
      pattern: /model.*(not found|does not exist|not exist|invalid|not have access)|unknown model|model_not_found/i,
      message: '模型名称可能填错，或当前账号没有权限使用这个模型。',
    },
    {
      pattern: /permission|forbidden|not have access|access denied|not allowed/i,
      message: '当前 API Key 没有访问权限，请检查账号权限、模型授权或服务商控制台配置。',
    },
    {
      pattern: /quota|insufficient_quota|billing|balance|credit|payment/i,
      message: '额度不足或计费未开通，请检查服务商账户余额、套餐或账单状态。',
    },
    {
      pattern: /rate limit|too many requests|requests per|429/i,
      message: '请求太频繁或被限流，请稍后再试，或检查服务商的频率限制。',
    },
    {
      pattern: /context length|maximum context|too many tokens|token limit/i,
      message: '请求内容过长，超过了模型支持的长度限制。',
    },
    {
      pattern: /timeout|timed out|deadline/i,
      message: '模型服务响应超时，请稍后重试或检查网络连接。',
    },
    {
      pattern: /not found|cannot post|cannot get|route|endpoint|path/i,
      message: '接口地址可能不正确，请检查是否填写到服务商的 API 根路径。',
    },
  ];

  const matched = rules.find((rule) => rule.pattern.test(raw));
  if (matched) {
    return matched.message;
  }

  if (/[\u4e00-\u9fff]/.test(raw)) {
    return raw;
  }

  return `模型服务返回了未识别的错误：${raw}`;
}

function responseStatusHint(status) {
  if (status === 400) {
    return '请求格式或模型参数不被该接口支持';
  }
  if (status === 401 || status === 403) {
    return 'API Key 无效或没有访问权限';
  }
  if (status === 404) {
    return '接口路径或模型名称可能不正确';
  }
  if (status === 429) {
    return '请求被限流或额度不足';
  }
  if (status >= 500) {
    return '模型服务端异常';
  }

  return '接口返回了错误状态';
}

async function testModelInBrowser(settings) {
  const endpoint = settings.endpoint.trim();
  const apiKey = settings.apiKey.trim();
  const model = settings.model.trim();

  if (!endpoint) {
    return { ok: false, message: '请先填写接口地址。' };
  }
  if (!apiKey) {
    return { ok: false, message: '请先填写 API Key。' };
  }
  if (!model) {
    return { ok: false, message: '请先填写模型名称。' };
  }

  let url;
  try {
    url = buildChatCompletionsUrl(endpoint);
  } catch (error) {
    return { ok: false, message: error.message || '接口地址格式不正确。' };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '请只回复 OK，用于测试模型连通性。' }],
        max_tokens: 8,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });

    const payload = await readResponsePayload(response);
    if (response.ok) {
      const content = payload.json?.choices?.[0]?.message?.content ?? payload.json?.choices?.[0]?.text;
      if (typeof content !== 'string') {
        return {
          ok: false,
          message: '接口已连接，但返回内容不是 OpenAI Chat Completions 兼容格式，请检查接口地址是否指向 /chat/completions。',
        };
      }

      return { ok: true, message: `连接成功，模型 ${model} 已返回响应。` };
    }

    const detail = payload.json?.error?.message || payload.json?.message || payload.text.slice(0, 180);
    const localizedDetail = localizeProviderError(detail);
    return {
      ok: false,
      message: `连接失败：HTTP ${response.status}，${responseStatusHint(response.status)}${localizedDetail ? `：${localizedDetail}` : '。'}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.name === 'AbortError' ? '连接超时，请检查接口地址或网络。' : `连接失败：${error?.message || '无法访问接口。'}`,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

async function askModelInBrowser(settings, question) {
  const endpoint = settings.endpoint.trim();
  const apiKey = settings.apiKey.trim();
  const model = settings.model.trim();
  const prompt = String(question || '').trim();

  if (!endpoint) {
    return { ok: false, message: '请先填写接口地址。' };
  }
  if (!apiKey) {
    return { ok: false, message: '请先填写 API Key。' };
  }
  if (!model) {
    return { ok: false, message: '请先填写模型名称。' };
  }
  if (!prompt) {
    return { ok: false, message: '请先填写测试内容。' };
  }

  let url;
  try {
    url = buildChatCompletionsUrl(endpoint);
  } catch (error) {
    return { ok: false, message: error.message || '接口地址格式不正确。' };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });

    const payload = await readResponsePayload(response);
    if (response.ok) {
      const content = payload.json?.choices?.[0]?.message?.content ?? payload.json?.choices?.[0]?.text;
      if (typeof content !== 'string') {
        return {
          ok: false,
          message: '接口已连接，但返回内容不是 OpenAI Chat Completions 兼容格式，请检查接口地址是否指向 /chat/completions。',
        };
      }

      return { ok: true, message: content.trim() || '模型返回了空内容。' };
    }

    const detail = payload.json?.error?.message || payload.json?.message || payload.text.slice(0, 180);
    const localizedDetail = localizeProviderError(detail);
    return {
      ok: false,
      message: `对话失败：HTTP ${response.status}，${responseStatusHint(response.status)}${localizedDetail ? `：${localizedDetail}` : '。'}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error?.name === 'AbortError' ? '连接超时，请检查接口地址或网络。' : `连接失败：${error?.message || '无法访问接口。'}`,
    };
  } finally {
    window.clearTimeout(timer);
  }
}

async function generateDailyReportInBrowser(settings, prompt) {
  const result = await askModelInBrowser(settings, prompt);
  if (!result.ok && typeof result.message === 'string') {
    return {
      ...result,
      message: result.message.replace(/^对话失败：/, '日报生成失败：'),
    };
  }

  return result;
}

function getCardScrollHeight(count) {
  const visibleRows = Math.min(count, MAX_VISIBLE_TASKS);
  if (visibleRows <= 0) {
    return TASK_SCROLL_PADDING;
  }

  return visibleRows * TASK_ROW_HEIGHT + Math.max(0, visibleRows - 1) * TASK_ROW_GAP + TASK_SCROLL_PADDING;
}

function getCardHeight(count, composing) {
  const composerHeight = composing ? COMPOSER_HEIGHT + COMPOSER_GAP : 0;
  return DAILY_HEAD_HEIGHT + getCardScrollHeight(count) + DAILY_FOOTER_HEIGHT + composerHeight;
}

function getTodayIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function minutesFromTimeText(timeText) {
  const match = String(timeText || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function getAutoReportDelay(reportTime, now = new Date(), allowCurrentMinute = true) {
  const targetMinutes = minutesFromTimeText(reportTime);
  if (targetMinutes === null) {
    return null;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const target = new Date(now);
  target.setHours(Math.floor(targetMinutes / 60), targetMinutes % 60, 0, 0);

  if (targetMinutes < currentMinutes || (targetMinutes === currentMinutes && !allowCurrentMinute)) {
    target.setDate(target.getDate() + 1);
  }

  return Math.max(0, target.getTime() - now.getTime());
}

function getAutoReportAttemptKey(day, settings) {
  if (!day) {
    return '';
  }

  const itemsKey = (day.items ?? [])
    .filter((item) => String(item?.text || '').trim())
    .map((item) => `${item.status || '进行中'}:${String(item.text || '').trim()}`)
    .join('|');
  const settingsKey = [
    settings?.endpoint,
    settings?.apiKey,
    settings?.model,
    settings?.complexity,
    settings?.template,
  ]
    .map((value) => String(value || '').trim())
    .join('|');

  return `${day.date}::${settingsKey}::${itemsKey}`;
}

function findDay(months, date) {
  for (const month of months) {
    const day = month.dayCards.find((entry) => entry.date === date);
    if (day) {
      return { month, day };
    }
  }
  return null;
}

function updateDay(months, date, updater) {
  return months.map((month) => ({
    ...month,
    dayCards: month.dayCards.map((day) => (day.date === date ? updater(day) : day)),
  }));
}

function upsertDay(months, targetMonthId, nextDay) {
  const targetMonthKey = targetMonthId?.match?.(/^\d{4}-\d{2}$/)
    ? targetMonthId
    : nextDay.date.slice(0, 7);
  const hasTargetMonth = months.some(
    (month) => month.id === targetMonthId || parseMonthLabel(month) === targetMonthKey,
  );

  const nextMonths = hasTargetMonth
    ? months.map((month) => {
        if (month.id !== targetMonthId && parseMonthLabel(month) !== targetMonthKey) {
          return month;
        }

        const exists = month.dayCards.some((day) => day.date === nextDay.date);
        return {
          ...month,
          dayCards: exists
            ? month.dayCards.map((day) => (day.date === nextDay.date ? nextDay : day))
            : [...month.dayCards, nextDay].sort((a, b) => a.date.localeCompare(b.date)),
        };
      })
    : [
        ...months,
        {
          ...createMonth(targetMonthKey),
          dayCards: [nextDay],
        },
      ];

  return sortMonths(nextMonths);
}

function upsertRangeReport(months, monthKey, report) {
  const hasTargetMonth = months.some((month) => parseMonthLabel(month) === monthKey);
  const nextMonths = hasTargetMonth
    ? months.map((month) => {
        if (parseMonthLabel(month) !== monthKey) {
          return month;
        }

        const nextReports = (month.rangeReports ?? []).filter(
          (item) => item.rangeStart !== report.rangeStart || item.rangeEnd !== report.rangeEnd,
        );

        return {
          ...month,
          rangeReports: [...nextReports, report].sort(
            (left, right) => getReportGeneratedTimestamp(right) - getReportGeneratedTimestamp(left),
          ),
        };
      })
    : [
        ...months,
        {
          ...createMonth(monthKey),
          rangeReports: [report],
        },
      ];

  return sortMonths(nextMonths);
}

function removeDay(months, date) {
  return sortMonths(
    months
      .map((month) => ({
        ...month,
        dayCards: month.dayCards.filter((day) => day.date !== date),
      }))
      .filter((month) => month.dayCards.length > 0 || month.rangeReports.length > 0),
  );
}

function removeRangeReport(months, reportId) {
  return sortMonths(
    months
      .map((month) => ({
        ...month,
        rangeReports: (month.rangeReports ?? []).filter((report) => report.id !== reportId),
      }))
      .filter((month) => month.dayCards.length > 0 || month.rangeReports.length > 0),
  );
}

function cloneItems(items) {
  return items.map((item) => ({ ...item }));
}

function getMonthKeyFromDate(date) {
  return date?.slice?.(0, 7) ?? '';
}

function getReportBucketKey(report) {
  return getMonthKeyFromDate(report.rangeStart || report.anchorDate || '');
}

function getReportBucketLabel(monthKey) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (!year || !month) {
    return monthKey;
  }

  return `${year}年${month}月`;
}

function getReportGeneratedTimestamp(report) {
  if (report?.generatedAt) {
    const generatedAt = Date.parse(report.generatedAt);
    if (Number.isFinite(generatedAt)) {
      return generatedAt;
    }
  }

  const sourceDate = report?.rangeStart || report?.anchorDate || '';
  const year = sourceDate.slice(0, 4);
  const legacyTime = typeof report?.time === 'string' ? report.time.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/) : null;
  if (year && legacyTime) {
    const generatedAt = Date.parse(
      `${year}-${legacyTime[1]}-${legacyTime[2]}T${legacyTime[3]}:${legacyTime[4]}:00`,
    );
    if (Number.isFinite(generatedAt)) {
      return generatedAt;
    }
  }

  const createdAt = Date.parse(report?.createdAt || '');
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function formatRangeReportTitle(start, end) {
  return `${formatDateLabel(start)} - ${formatDateLabel(end)}汇总`;
}

function formatCurrentTimeLabel() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function normalizeRange(start, end) {
  return start <= end ? [start, end] : [end, start];
}

function isDateBetween(date, start, end) {
  const [left, right] = normalizeRange(start, end);
  return date >= left && date <= right;
}

function enumerateIsoDates(start, end) {
  const [left, right] = normalizeRange(start, end);
  const dates = [];
  const cursor = new Date(`${left}T12:00:00`);
  const limit = new Date(`${right}T12:00:00`);

  while (cursor <= limit) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    dates.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function buildRangeReportText(months, start, end) {
  let coveredDays = 0;
  let totalItems = 0;
  const days = [];

  enumerateIsoDates(start, end).forEach((iso) => {
    const found = findDay(months, iso);
    const day = found?.day ?? null;
    const items = day?.items?.filter((item) => String(item?.text || '').trim()) ?? [];

    if (items.length) {
      coveredDays += 1;
      totalItems += items.length;
      days.push({
        ...day,
        items,
      });
    }
  });

  return {
    title: formatRangeReportTitle(start, end),
    note: `${coveredDays} 天 / ${totalItems} 条事项`,
    days,
    totalItems,
  };
}

function buildReportGroups(months) {
  const groups = new Map();

  months.forEach((month) => {
    month.rangeReports?.forEach((report) => {
      const key = getReportBucketKey(report);
      if (!key) {
        return;
      }

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: getReportBucketLabel(key),
          reports: [],
        });
      }

      groups.get(key).reports.push(report);
    });
  });

  return [...groups.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((group) => ({
      ...group,
      reports: [...group.reports].sort((a, b) => {
        const generatedCompare = getReportGeneratedTimestamp(b) - getReportGeneratedTimestamp(a);
        if (generatedCompare !== 0) {
          return generatedCompare;
        }

        const left = a.rangeEnd || a.rangeStart || a.anchorDate || '';
        const right = b.rangeEnd || b.rangeStart || b.anchorDate || '';
        return right.localeCompare(left);
      }),
    }));
}

function getReportText(day) {
  if (!day) {
    return '';
  }

  return day.reportText ?? (day.reportReady ? DEFAULT_REPORT_TEXT : '');
}

function viewName() {
  const hash = window.location.hash.replace('#/', '');
  if (hash === 'manager' || hash === 'settings') {
    return hash;
  }
  return 'floating';
}

function scrollWheelTarget(target, deltaY) {
  const maxScrollTop = target.scrollHeight - target.clientHeight;
  if (maxScrollTop <= 0) {
    return false;
  }

  const nextScrollTop = target.scrollTop + deltaY;
  const clamped = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
  if (clamped === target.scrollTop) {
    return false;
  }

  target.scrollTop = clamped;
  return true;
}

function getCalendarCellDate(target) {
  return target instanceof Element ? target.closest('[data-day-date]')?.getAttribute('data-day-date') ?? null : null;
}

const STATUS_BUTTONS = [
  {
    value: '进行中',
    accent: '#5a7fc8',
    tint: 'rgba(90, 127, 200, 0.14)',
    icon: RunningIcon,
  },
  {
    value: '停滞',
    accent: '#d28a35',
    tint: 'rgba(210, 138, 53, 0.14)',
    icon: MinusIcon,
  },
  {
    value: '完成',
    accent: '#39a86b',
    tint: 'rgba(57, 168, 107, 0.14)',
    icon: CheckIcon,
  },
  {
    value: '放弃',
    accent: '#d13b3b',
    tint: 'rgba(209, 59, 59, 0.18)',
    icon: CloseIcon,
  },
];

function RunningIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="16" cy="5" r="2" fill="currentColor" stroke="none" />
      <path d="M12.6 7.4 10.4 10l2.4 1.8-1.3 3.6" />
      <path d="M13.2 10.2 17 11.6" />
      <path d="M10.7 14.3 7.9 19" />
      <path d="M15.2 14 18 18.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 12.5 10 17 18.5 7.5" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function StatusButtons({ value, onChange, className = "" }) {
  const classes = ["status-buttons", className].filter(Boolean).join(" ");

  return (
    <div className={classes} role="group" aria-label="事项状态">
      {STATUS_BUTTONS.map((status) => {
        const active = value === status.value;
        const Icon = status.icon;

        return (
          <button
            key={status.value}
            type="button"
            className={"status-icon-btn" + (active ? " active" : "")}
            style={{ "--status-accent": status.accent, "--status-tint": status.tint }}
            title={status.value}
            aria-label={status.value}
            aria-pressed={active}
            onClick={() => onChange(status.value)}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}

function StatusIcons({ value }) {
  return (
    <div className="status-buttons" role="img" aria-label={value}>
      {STATUS_BUTTONS.map((status) => {
        const active = value === status.value;
        const Icon = status.icon;

        return (
          <span
            key={status.value}
            className={"status-icon-btn" + (active ? " active" : "")}
            style={{ "--status-accent": status.accent, "--status-tint": status.tint }}
            aria-hidden="true"
          >
            <Icon />
          </span>
        );
      })}
    </div>
  );
}

function IconButton({ children, title, onClick, className = '' }) {
  return (
    <button className={`icon-btn ${className}`} type="button" title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function TextButton({ children, onClick, tone = 'light' }) {
  return (
    <button className={`text-btn text-btn-${tone}`} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

export default function App() {
  const [screen, setScreen] = useState(viewName);
  const [months, setMonths] = useState(() => cloneMonths());
  const [currentMonthKey, setCurrentMonthKey] = useState(() => getTodayIso().slice(0, 7));
  const [composer, setComposer] = useState(null);
  const [detail, setDetail] = useState(null);
  const [isResizing, setIsResizing] = useState(false);
  const [pendingRevealDate, setPendingRevealDate] = useState(null);
  const [cardMenu, setCardMenu] = useState(null);
  const [dateMenu, setDateMenu] = useState(null);
  const [rangeSelection, setRangeSelection] = useState(null);
  const [rangeMenu, setRangeMenu] = useState(null);
  const [rangeReportMenu, setRangeReportMenu] = useState(null);
  const [modelTest, setModelTest] = useState({ status: 'idle', message: '' });
  const [dataTransfer, setDataTransfer] = useState({ status: 'idle', message: '' });
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [dialogTest, setDialogTest] = useState({ status: 'idle', message: '', request: '' });
  const [aiDebugEntries, setAiDebugEntries] = useState([]);
  const [reportGeneration, setReportGeneration] = useState({ status: 'idle', date: null, message: '' });
  const [rangeGeneration, setRangeGeneration] = useState({ status: 'idle', rangeStart: null, rangeEnd: null, message: '' });
  const floatSurfaceRef = useRef(null);
  const dayListRef = useRef(null);
  const latestMonthsRef = useRef(months);
  const latestSettingsRef = useRef(DEFAULT_SETTINGS);
  const autoReportAttemptedKeysRef = useRef(new Set());
  const autoReportRunningRef = useRef(false);
  const confirmDialogResolverRef = useRef(null);
  const calendarSelectionRef = useRef({
    timer: null,
    anchor: null,
    active: false,
    suppressClick: false,
  });
  const isApplyingRemoteStateRef = useRef(false);
  const hasStateBridge = Boolean(window.dailog?.getAppState && window.dailog?.setAppState);
  const [isStateReady, setIsStateReady] = useState(!hasStateBridge);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const currentMonth = useMemo(
    () => months.find((month) => parseMonthLabel(month) === currentMonthKey) ?? createMonth(currentMonthKey),
    [months, currentMonthKey],
  );
  const rows = useMemo(() => (currentMonth ? buildCalendarRows(currentMonth) : []), [currentMonth]);
  const rangeGroups = useMemo(() => buildReportGroups(months), [months]);
  const rangeSelectionBounds = rangeSelection ? normalizeRange(rangeSelection.start, rangeSelection.end) : null;
  const detailLookup = detail ? findDay(months, detail.date) : null;
  const detailDay = detailLookup?.day ?? null;
  const detailRangeLookup =
    detail?.kind === 'range'
      ? months
          .find((month) => parseMonthLabel(month) === getMonthKeyFromDate(detail.rangeStart))
          ?.rangeReports?.find((report) => report.id === detail.id) ?? null
      : null;
  const visibleDateItems = (items) =>
    items.length > MAX_VISIBLE_DATE_ITEMS
      ? [...items.slice(0, MAX_VISIBLE_DATE_ITEMS - 1), null]
      : items.slice(0, MAX_VISIBLE_DATE_ITEMS);
  const isGeneratingDaily = (date) => reportGeneration.status === 'testing' && reportGeneration.date === date;
  const isGeneratingRange =
    rangeGeneration.status === 'testing' &&
    rangeSelectionBounds &&
    rangeGeneration.rangeStart === rangeSelectionBounds[0] &&
    rangeGeneration.rangeEnd === rangeSelectionBounds[1];
  useEffect(() => {
    latestMonthsRef.current = months;
    latestSettingsRef.current = settings;
  }, [months, settings]);

  useEffect(() => {
    if (!hasStateBridge) {
      return undefined;
    }

    let disposed = false;

    window.dailog.getAppState().then((nextState) => {
      if (disposed) {
        return;
      }

      if (nextState?.months || nextState?.settings || Array.isArray(nextState?.aiDebugEntries)) {
        isApplyingRemoteStateRef.current = true;
        if (nextState.months) {
          setMonths(sortMonths(nextState.months));
        }
        if (nextState.settings) {
          setSettings(normalizeSettings(nextState.settings));
        }
        if (Array.isArray(nextState.aiDebugEntries)) {
          setAiDebugEntries(normalizeAiDebugEntries(nextState.aiDebugEntries));
        }
      }

      setIsStateReady(true);
    });

    const unsubscribe = window.dailog.onAppStateChanged?.((nextState) => {
      if (!nextState) {
        return;
      }

      isApplyingRemoteStateRef.current = true;
      if (nextState.months) {
        setMonths(sortMonths(nextState.months));
      }
      if (nextState.settings) {
        setSettings(normalizeSettings(nextState.settings));
      }
      if (Array.isArray(nextState.aiDebugEntries)) {
        setAiDebugEntries(normalizeAiDebugEntries(nextState.aiDebugEntries));
      }
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [hasStateBridge]);

  useEffect(() => {
    if (!hasStateBridge || !isStateReady) {
      return;
    }

    if (isApplyingRemoteStateRef.current) {
      isApplyingRemoteStateRef.current = false;
      return;
    }

    window.dailog.setAppState({ months, settings, aiDebugEntries });
  }, [aiDebugEntries, hasStateBridge, isStateReady, months, settings]);

  useEffect(() => {
    if (screen !== 'floating') {
      return undefined;
    }

    const surface = floatSurfaceRef.current;
    if (!(surface instanceof HTMLElement)) {
      return undefined;
    }

    const handleWheel = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const innerScroll = target?.closest('.daily-scroll');

      if (innerScroll instanceof HTMLElement && scrollWheelTarget(innerScroll, event.deltaY)) {
        event.preventDefault();
        return;
      }

      const outerList = dayListRef.current;
      if (outerList instanceof HTMLElement && scrollWheelTarget(outerList, event.deltaY)) {
        event.preventDefault();
      }
    };

    surface.addEventListener('wheel', handleWheel, { passive: false });
    return () => surface.removeEventListener('wheel', handleWheel);
  }, [screen, currentMonthKey]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const stopResize = () => {
      window.dailog?.endWindowResize?.();
      setIsResizing(false);
    };

    window.addEventListener('mouseup', stopResize);
    window.addEventListener('blur', stopResize);

    return () => {
      window.removeEventListener('mouseup', stopResize);
      window.removeEventListener('blur', stopResize);
    };
  }, [isResizing]);

  useEffect(() => {
    if (screen !== 'floating' || !pendingRevealDate) {
      return undefined;
    }

    const revealDate = pendingRevealDate?.date ?? pendingRevealDate;
    const frame = window.requestAnimationFrame(() => {
      const list = dayListRef.current;
      const card = list?.querySelector?.(`[data-day-date="${revealDate}"]`);
      if (list instanceof HTMLElement && card instanceof HTMLElement) {
        const nextTop = card.offsetTop - (list.clientHeight - card.offsetHeight) / 2;
        list.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
      }
    });

    const timeout = window.setTimeout(() => {
      setPendingRevealDate(null);
    }, 1100);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [screen, currentMonthKey, pendingRevealDate]);

  useEffect(() => {
    if (!cardMenu) {
      return undefined;
    }

    const closeMenu = () => setCardMenu(null);
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [cardMenu]);

  useEffect(() => {
    if (!dateMenu) {
      return undefined;
    }

    const closeMenu = () => setDateMenu(null);
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [dateMenu]);

  useEffect(() => {
    if (!rangeMenu) {
      return undefined;
    }

    const closeMenu = () => setRangeMenu(null);
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [rangeMenu]);

  useEffect(() => {
    if (!rangeReportMenu) {
      return undefined;
    }

    const closeMenu = () => setRangeReportMenu(null);
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [rangeReportMenu]);

  useEffect(() => {
    if (!rangeSelection) {
      return undefined;
    }

    const handleOutsideSelectionPointerDown = (event) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }

      if (target.closest('.range-menu') || target.closest('.date-cell.is-selected')) {
        return;
      }

      clearRangeSelection();
    };

    document.addEventListener('pointerdown', handleOutsideSelectionPointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsideSelectionPointerDown, true);
  }, [rangeSelection?.start, rangeSelection?.end]);

  useEffect(
    () => () => {
      if (calendarSelectionRef.current.timer) {
        window.clearTimeout(calendarSelectionRef.current.timer);
      }
    },
    [],
  );

  useEffect(() => {
    setModelTest((prev) => (prev.status === 'idle' ? prev : { status: 'idle', message: '' }));
    setDialogTest((prev) => (prev.status === 'idle' ? prev : { status: 'idle', message: '' }));
  }, [settings.endpoint, settings.apiKey, settings.model]);

  const showScreen = (nextScreen) => {
    window.location.hash = `/${nextScreen}`;
    setScreen(nextScreen);
  };

  const updateAiSetting = (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setModelTest({ status: 'idle', message: '' });
    setDialogTest({ status: 'idle', message: '', request: '' });
  };

  const appendAiDebugEntry = (entry) => {
    setAiDebugEntries((prev) =>
      [
        {
          id: `debug-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: formatCurrentTimeLabel(),
          ...entry,
        },
        ...prev,
      ].slice(0, 8),
    );
  };

  const clearAiDebugEntries = () => {
    setAiDebugEntries([]);
    setDialogTest({ status: 'idle', message: '', request: '' });
  };

  const previousMonth = () => setCurrentMonthKey((value) => shiftMonthKey(value, -1));
  const nextMonth = () => setCurrentMonthKey((value) => shiftMonthKey(value, 1));

  const openComposer = (date) => {
    setComposer({ date, text: '' });
  };

  const revealTodayCard = () => {
    const today = getTodayIso();
    const todayMonthKey = today.slice(0, 7);

    setMonths((prev) => {
      const targetMonth = prev.find((month) => parseMonthLabel(month) === todayMonthKey);
      if (targetMonth?.dayCards.some((day) => day.date === today)) {
        return prev;
      }

      return upsertDay(prev, todayMonthKey, {
        ...makeBlankDay(today),
        items: [],
      });
    });

    setCurrentMonthKey(todayMonthKey);
    setComposer(null);
    setPendingRevealDate({ date: today, token: Date.now() });
  };

  const openCardMenu = (event, date) => {
    event.preventDefault();
    event.stopPropagation();
    const width = 182;
    const height = 132;
    setCardMenu({
      date,
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - width - 12)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - height - 12)),
    });
  };

  const openDateMenu = (event, date) => {
    event.preventDefault();
    event.stopPropagation();
    const width = 182;
    const height = 132;
    setDateMenu({
      date,
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - width - 12)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - height - 12)),
    });
  };

  const closeCardMenu = () => {
    setCardMenu(null);
  };

  const viewCardReport = (date) => {
    closeCardMenu();
    openDetail(date);
  };

  const regenerateCardReport = (date) => {
    closeCardMenu();
    setPendingRevealDate(date);
    runDailyReportGeneration(date, '重新生成日报');
  };

  const runDailyReportGeneration = async (date, title = '生成日报', options = {}) => {
    const sourceMonths = options.months ?? months;
    const sourceSettings = options.settings ?? settings;
    const found = findDay(sourceMonths, date);
    const day = found?.day ?? null;
    const cleanItems = day?.items?.filter((item) => String(item?.text || '').trim()) ?? [];

    if (!day || cleanItems.length === 0) {
      const message = '日报生成失败：当天没有事项记录。';
      setReportGeneration({ status: 'error', date, message });
      appendAiDebugEntry({
        title,
        status: 'error',
        request: `${date} 无事项记录`,
        response: message,
      });
      return;
    }

    const prompt = buildDailyReportPrompt({ day: { ...day, items: cleanItems }, settings: sourceSettings });
    setReportGeneration({ status: 'testing', date, message: '正在生成日报...' });

    try {
      const payload = {
        endpoint: sourceSettings.endpoint,
        apiKey: sourceSettings.apiKey,
        model: sourceSettings.model,
      };
      const result = window.dailog?.generateDailyReport
        ? await window.dailog.generateDailyReport(payload, prompt)
        : await generateDailyReportInBrowser(sourceSettings, prompt);
      const response = result?.message || (result?.ok ? '日报已生成。' : '日报生成失败。');

      appendAiDebugEntry({
        title,
        status: result?.ok ? 'success' : 'error',
        request: prompt,
        response,
      });

      if (!result?.ok) {
        setReportGeneration({ status: 'error', date, message: response });
        return;
      }

      setMonths((prev) =>
        updateDay(prev, date, (currentDay) => ({
          ...currentDay,
          reportReady: true,
          reportText: response,
        })),
      );
      setDetail((prev) => {
        if (prev?.kind !== 'day' || prev.date !== date) {
          return prev;
        }

        return {
          ...prev,
          draftReportText: response,
          mode: 'browse',
        };
      });
      setReportGeneration({ status: 'success', date, message: '日报已生成。' });
    } catch (error) {
      const message = `日报生成失败：${error?.message || '无法访问接口。'}`;
      setReportGeneration({ status: 'error', date, message });
      appendAiDebugEntry({
        title,
        status: 'error',
        request: prompt,
        response: message,
      });
    }
  };

  useEffect(() => {
    if (screen !== 'floating' || !isStateReady) {
      return undefined;
    }

    let disposed = false;
    let timer = null;

    const tryGenerateToday = async () => {
      const today = getTodayIso();
      if (autoReportRunningRef.current) {
        return;
      }

      const currentMonths = latestMonthsRef.current;
      const currentSettings = latestSettingsRef.current;
      const day = findDay(currentMonths, today)?.day ?? null;
      const hasItems = day?.items?.some((item) => String(item?.text || '').trim());
      if (!day || day.reportReady || !hasItems) {
        return;
      }

      const attemptKey = getAutoReportAttemptKey(day, currentSettings);
      if (!attemptKey || autoReportAttemptedKeysRef.current.has(attemptKey)) {
        return;
      }

      autoReportAttemptedKeysRef.current.add(attemptKey);
      autoReportRunningRef.current = true;
      await Promise.resolve(
        runDailyReportGeneration(today, '自动生成日报', {
          months: currentMonths,
          settings: currentSettings,
        }),
      ).finally(() => {
        autoReportRunningRef.current = false;
      });
    };

    const scheduleNext = (allowCurrentMinute) => {
      if (disposed) {
        return;
      }

      const delay = getAutoReportDelay(latestSettingsRef.current.reportTime, new Date(), allowCurrentMinute);
      if (delay === null) {
        return;
      }

      timer = window.setTimeout(async () => {
        await tryGenerateToday();
        scheduleNext(false);
      }, delay);
    };

    scheduleNext(true);
    return () => {
      disposed = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [isStateReady, screen, settings.reportTime]);

  const generateDailyReport = (date) => {
    setDateMenu(null);
    runDailyReportGeneration(date, '生成日报');
  };

  const regenerateDailyReport = (date) => {
    setDateMenu(null);
    runDailyReportGeneration(date, '重新生成日报');
  };

  const deleteDateContent = (date) => {
    setDateMenu(null);
    setMonths((prev) => removeDay(prev, date));
    setDetail((prev) => (prev?.kind === 'day' && prev.date === date ? null : prev));
  };

  const deleteCard = (date) => {
    closeCardMenu();
    setMonths((prev) => removeDay(prev, date));

    setComposer((prev) => (prev?.date === date ? null : prev));
    setPendingRevealDate((prev) => (prev === date ? null : prev));
    setDetail((prev) => (prev?.date === date ? null : prev));
  };

  const clearRangeSelection = () => {
    if (calendarSelectionRef.current.timer) {
      window.clearTimeout(calendarSelectionRef.current.timer);
    }

    calendarSelectionRef.current = {
      timer: null,
      anchor: null,
      active: false,
      suppressClick: false,
    };
    setRangeSelection(null);
    setRangeMenu(null);
  };

  const updateRangeSelection = (anchor, current) => {
    if (!anchor || !current) {
      return;
    }

    setRangeSelection({
      start: anchor,
      end: current,
    });
  };

  const beginRangeSelection = (event, date) => {
    if (event.button !== 0) {
      return;
    }

    if (calendarSelectionRef.current.timer) {
      window.clearTimeout(calendarSelectionRef.current.timer);
    }

    const anchor = date;
    calendarSelectionRef.current = {
      timer: window.setTimeout(() => {
        calendarSelectionRef.current.active = true;
        updateRangeSelection(anchor, anchor);
      }, 220),
      anchor,
      active: false,
      suppressClick: false,
    };

    const handleMove = (moveEvent) => {
      const state = calendarSelectionRef.current;
      if (!state.active || !state.anchor) {
        return;
      }

      const nextDate = getCalendarCellDate(document.elementFromPoint(moveEvent.clientX, moveEvent.clientY));
      if (nextDate) {
        updateRangeSelection(state.anchor, nextDate);
      }
    };

    const handleUp = (upEvent) => {
      const state = calendarSelectionRef.current;
      if (state.timer) {
        window.clearTimeout(state.timer);
      }

      if (state.active && state.anchor) {
        const nextDate = getCalendarCellDate(document.elementFromPoint(upEvent.clientX, upEvent.clientY)) || state.anchor;
        updateRangeSelection(state.anchor, nextDate);
        state.suppressClick = true;
        window.setTimeout(() => {
          state.suppressClick = false;
        }, 0);
      }

      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const openRangeSelectionMenu = (event) => {
    if (!rangeSelectionBounds) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const width = 194;
    const height = 92;
    setRangeMenu({
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - width - 12)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - height - 12)),
    });
  };

  const handleDateCellClick = (date) => {
    if (calendarSelectionRef.current.suppressClick) {
      calendarSelectionRef.current.suppressClick = false;
      return;
    }

    if (rangeSelection && !isDateBetween(date, rangeSelectionBounds[0], rangeSelectionBounds[1])) {
      clearRangeSelection();
      return;
    }

    openDetail(date);
  };

  const handleCalendarContextMenu = (event) => {
    event.preventDefault();
  };

  const handleDateCellContextMenu = (event, date) => {
    event.preventDefault();
    event.stopPropagation();

    if (rangeSelectionBounds) {
      if (isDateBetween(date, rangeSelectionBounds[0], rangeSelectionBounds[1])) {
        openRangeSelectionMenu(event);
      }
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.date-cell-title')) {
      openDateMenu(event, date);
    }
  };

  const openRangeDetail = (report) => {
    setDetail({
      kind: 'range',
      id: report.id,
      date: report.anchorDate ?? report.rangeEnd ?? report.rangeStart,
      mode: 'browse',
      title: report.title,
      rangeStart: report.rangeStart,
      rangeEnd: report.rangeEnd,
      draftReportText: report.reportText ?? report.note ?? '',
      isNew: false,
    });
  };

  const openRangeReportMenu = (event, report) => {
    event.preventDefault();
    event.stopPropagation();
    const width = 182;
    const height = 48;

    setRangeReportMenu({
      reportId: report.id,
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - width - 12)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - height - 12)),
    });
  };

  const deleteRangeReport = (reportId) => {
    setRangeReportMenu(null);
    setMonths((prev) => removeRangeReport(prev, reportId));
    setDetail((prev) => (prev?.kind === 'range' && prev.id === reportId ? null : prev));
  };

  const generateRangeReport = async () => {
    if (!rangeSelectionBounds) {
      return;
    }

    const [rangeStart, rangeEnd] = rangeSelectionBounds;
    const monthKey = getMonthKeyFromDate(rangeStart);
    const payload = buildRangeReportText(months, rangeStart, rangeEnd);

    if (!payload.totalItems) {
      const message = '区间汇报生成失败：选中区间没有事项记录。';
      setRangeGeneration({ status: 'error', rangeStart, rangeEnd, message });
      appendAiDebugEntry({
        title: '生成区间汇报',
        status: 'error',
        request: `${rangeStart} 至 ${rangeEnd} 无事项记录`,
        response: message,
      });
      return;
    }

    const prompt = buildRangeReportPrompt({
      rangeStart,
      rangeEnd,
      days: payload.days,
      settings,
    });
    setRangeGeneration({ status: 'testing', rangeStart, rangeEnd, message: '正在生成区间汇报...' });

    try {
      const aiPayload = {
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
      };
      const result = window.dailog?.generateDailyReport
        ? await window.dailog.generateDailyReport(aiPayload, prompt)
        : await generateDailyReportInBrowser(settings, prompt);
      const response = (
        result?.message || (result?.ok ? '区间汇报已生成。' : '区间汇报生成失败。')
      ).replace(/^日报生成失败：/, '区间汇报生成失败：');

      appendAiDebugEntry({
        title: '生成区间汇报',
        status: result?.ok ? 'success' : 'error',
        request: prompt,
        response,
      });

      if (!result?.ok) {
        setRangeGeneration({ status: 'error', rangeStart, rangeEnd, message: response });
        return;
      }

      const report = {
        id: `range-${Date.now()}`,
        time: formatCurrentTimeLabel(),
        generatedAt: new Date().toISOString(),
        title: payload.title,
        note: payload.note,
        reportText: response,
        anchorDate: rangeEnd,
        rangeStart,
        rangeEnd,
      };

      setMonths((prev) => upsertRangeReport(prev, monthKey, report));

      setDetail({
        kind: 'range',
        id: report.id,
        date: report.anchorDate,
        mode: 'browse',
        title: report.title,
        rangeStart: report.rangeStart,
        rangeEnd: report.rangeEnd,
        draftReportText: report.reportText,
        isNew: false,
      });
      setRangeGeneration({ status: 'success', rangeStart, rangeEnd, message: '区间汇报已生成。' });
      setRangeMenu(null);
      clearRangeSelection();
    } catch (error) {
      const message = `区间汇报生成失败：${error?.message || '无法访问接口。'}`;
      setRangeGeneration({ status: 'error', rangeStart, rangeEnd, message });
      appendAiDebugEntry({
        title: '生成区间汇报',
        status: 'error',
        request: prompt,
        response: message,
      });
    }
  };

  const startResize = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsResizing(true);
    window.dailog?.startWindowResize?.();
  };

  const saveComposer = () => {
    if (!composer?.text.trim()) {
      setComposer(null);
      return;
    }

    const nextItem = {
      id: `item-${Date.now()}`,
      text: composer.text.trim(),
      status: '进行中',
    };

    setMonths((prev) => {
      const existing = findDay(prev, composer.date);
      if (existing) {
        return updateDay(prev, composer.date, (day) => ({
          ...day,
          items: [...day.items, nextItem],
        }));
      }

      return upsertDay(prev, composer.date.slice(0, 7), {
        ...makeBlankDay(composer.date),
        items: [nextItem],
      });
    });

    setComposer(null);
  };


  const updateItemStatus = (date, itemId, status) => {
    setMonths((prev) =>
      updateDay(prev, date, (day) => ({
        ...day,
        items: day.items.map((item) => (item.id === itemId ? { ...item, status } : item)),
      })),
    );
  };

  const removeItem = (date, itemId) => {
    setMonths((prev) =>
      updateDay(prev, date, (day) => ({
        ...day,
        items: day.items.filter((item) => item.id !== itemId),
      })),
    );
  };

  const openDetail = (date) => {
    const found = findDay(months, date);
    setDetail({
      kind: 'day',
      date,
      mode: found ? 'browse' : 'edit',
      draftItems: found ? cloneItems(found.day.items) : [{ id: `draft-${Date.now()}`, text: '', status: '进行中' }],
      draftReportText: getReportText(found?.day),
      isNew: !found,
    });
  };

  const saveDetail = () => {
    if (!detail) {
      return;
    }

    if (detail.kind === 'range') {
      const cleanReportText = (detail.draftReportText ?? '').trim();
      setMonths((prev) =>
        prev.map((month) => {
          if (parseMonthLabel(month) !== getMonthKeyFromDate(detail.rangeStart)) {
            return month;
          }

          return {
            ...month,
            rangeReports: (month.rangeReports ?? []).map((report) =>
              report.id === detail.id
                ? {
                    ...report,
                    reportText: cleanReportText,
                    note: cleanReportText ? cleanReportText.split('\n').find(Boolean) ?? report.note : report.note,
                  }
                : report,
            ),
          };
        }),
      );

      setDetail((prev) => (prev?.kind === 'range' ? null : prev));
      return;
    }

    const cleanItems = detail.draftItems
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text);
    const cleanReportText = (detail.draftReportText ?? '').trim();

    setMonths((prev) => {
      const existing = findDay(prev, detail.date);
      if (cleanItems.length === 0) {
        return prev;
      }

      return upsertDay(prev, detail.date.slice(0, 7), {
        ...(existing?.day ?? makeBlankDay(detail.date)),
        items: cleanItems,
        reportReady: Boolean(cleanReportText),
        reportText: cleanReportText,
      });
    });

    setDetail(null);
  };

  const updateDetailItem = (itemId, patch) => {
    setDetail((prev) => ({
      ...prev,
      draftItems: prev.draftItems.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    }));
  };

  const testModelConnection = async () => {
    setModelTest({ status: 'testing', message: '正在测试连接...' });

    try {
      const payload = {
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
      };
      const result = window.dailog?.testModelConnection
        ? await window.dailog.testModelConnection(payload)
        : await testModelInBrowser(settings);

      setModelTest({
        status: result?.ok ? 'success' : 'error',
        message: result?.message || (result?.ok ? '连接成功。' : '连接失败。'),
      });
    } catch (error) {
      setModelTest({
        status: 'error',
        message: `连接失败：${error?.message || '无法访问接口。'}`,
      });
    }
  };

  const showConfirmDialog = (options) =>
    new Promise((resolve) => {
      confirmDialogResolverRef.current = resolve;
      setConfirmDialog(options);
    });

  const closeConfirmDialog = (confirmed) => {
    if (confirmDialogResolverRef.current) {
      confirmDialogResolverRef.current(confirmed);
      confirmDialogResolverRef.current = null;
    }
    setConfirmDialog(null);
  };

  const exportJsonData = async (exportType) => {
    if (exportType === 'full') {
      const confirmed = await showConfirmDialog({
        title: '确认全部数据导出',
        message: '全部数据导出会把 AI 接口、模型名称和 API Key 一起保存到 JSON 文件。',
        note: '请只保存到可信位置，避免把包含密钥的文件上传或分享给他人。',
        confirmText: '继续导出',
      });
      if (!confirmed) {
        return;
      }
    }

    setDataTransfer({ status: 'testing', message: exportType === 'full' ? '正在准备全部数据导出...' : '正在准备记录导出...' });

    try {
      const payload = buildExportPayload(exportType, { months, settings });
      if (!window.dailog?.exportData) {
        downloadJsonInBrowser(exportType, payload);
        setDataTransfer({ status: 'success', message: '导出完成：已交给浏览器下载。' });
        return;
      }

      const result = await window.dailog.exportData(exportType, payload);
      if (result?.canceled) {
        setDataTransfer({ status: 'idle', message: '已取消导出。' });
        return;
      }

      setDataTransfer({
        status: result?.ok ? 'success' : 'error',
        message: result?.ok ? `导出完成：${result.filePath || '已保存 JSON 文件。'}` : result?.message || '导出失败。',
      });
    } catch (error) {
      setDataTransfer({ status: 'error', message: `导出失败：${error?.message || '无法保存文件。'}` });
    }
  };

  const importJsonData = async (importType) => {
    const confirmed = await showConfirmDialog(
      importType === 'full'
        ? {
            title: '确认全量导入',
            message: '全量导入会完全覆盖本地记录和所有设置，包括 AI 接口、模型名称和 API Key。',
            note: '导入后当前设置会按 JSON 文件同步更新，请确认文件来源可信。',
            confirmText: '继续导入',
          }
        : {
            title: '确认数据导入',
            message: '数据导入会覆盖本地记录、日报和区间汇报，但不会修改当前设置。',
            note: '导入前建议先导出一份当前记录，方便需要时回退。',
            confirmText: '继续导入',
          },
    );
    if (!confirmed) {
      return;
    }

    setDataTransfer({ status: 'testing', message: importType === 'full' ? '正在导入全部数据...' : '正在导入记录数据...' });

    try {
      const result = window.dailog?.importData ? await window.dailog.importData() : await importJsonInBrowser();
      if (result?.canceled) {
        setDataTransfer({ status: 'idle', message: '已取消导入。' });
        return;
      }
      if (!result?.ok) {
        setDataTransfer({ status: 'error', message: result?.message || '导入失败。' });
        return;
      }

      const imported = readImportPayload(result.payload, importType);
      const nextMonthKey = imported.months[0] ? parseMonthLabel(imported.months[0]) : getTodayIso().slice(0, 7);

      setMonths(imported.months);
      setCurrentMonthKey(nextMonthKey);
      if (importType === 'full') {
        setSettings(imported.settings);
      }
      setAiDebugEntries([]);
      setComposer(null);
      setDetail(null);
      setCardMenu(null);
      setDateMenu(null);
      setRangeSelection(null);
      setRangeMenu(null);
      setRangeReportMenu(null);
      setDataTransfer({
        status: 'success',
        message: importType === 'full' ? '全量导入完成，记录和设置已更新。' : '数据导入完成，记录已更新，设置保持不变。',
      });
    } catch (error) {
      setDataTransfer({ status: 'error', message: error?.message || '导入失败：文件内容无法识别。' });
    }
  };

  const testModelDialog = async () => {
    const prompt = settings.aiDebugPrompt.trim();
    if (!prompt) {
      setDialogTest({ status: 'error', message: '请先填写测试内容。', request: '' });
      return;
    }

    setDialogTest({ status: 'testing', message: '等待模型回复...', request: prompt });

    try {
      const payload = {
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
      };
      const result = window.dailog?.askModelQuestion
        ? await window.dailog.askModelQuestion(payload, prompt)
        : await askModelInBrowser(settings, prompt);

      const nextEntry = {
        id: `debug-${Date.now()}`,
        title: '对话测试',
        status: result?.ok ? 'success' : 'error',
        request: prompt,
        response: result?.message || (result?.ok ? '模型已回复。' : '对话失败。'),
        time: formatCurrentTimeLabel(),
      };

      setDialogTest({
        status: nextEntry.status,
        message: nextEntry.response,
        request: prompt,
      });
      setAiDebugEntries((prev) => [nextEntry, ...prev].slice(0, 8));
    } catch (error) {
      const response = `对话失败：${error?.message || '无法访问接口。'}`;
      setDialogTest({
        status: 'error',
        message: response,
        request: prompt,
      });
      setAiDebugEntries((prev) =>
        [
          {
            id: `debug-${Date.now()}`,
            title: '对话测试',
            status: 'error',
            request: prompt,
            response,
            time: formatCurrentTimeLabel(),
          },
          ...prev,
        ].slice(0, 8),
      );
    }
  };

  const scrollRangeMonth = (event) => {
    const scroller = event.currentTarget;
    if (!(scroller instanceof HTMLElement) || scroller.scrollWidth <= scroller.clientWidth) {
      return;
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) {
      return;
    }

    scroller.scrollLeft += delta;
    event.preventDefault();
  };

  return (
    <>
      {screen === 'floating' ? renderFloating() : null}
      {screen === 'manager' ? renderManager() : null}
      {screen === 'settings' ? renderSettings() : null}
      {detail ? renderDetail() : null}
      {confirmDialog ? renderConfirmDialog() : null}
    </>
  );

  function renderFloating() {
    return (
      <main className="float-root" style={{ "--float-alpha": settings.opacity / 100 }}>
        <section className="float-window">
          <div className="float-surface" ref={floatSurfaceRef}>
            <header className="float-titlebar">
              <div>
                <div className="app-name">Dailog</div>
              </div>
              <div className="title-actions">
                <IconButton title="定位今天日期框" onClick={revealTodayCard}>＋</IconButton>
                <IconButton title="关闭悬浮窗" onClick={() => window.dailog?.closeFloating?.()}>×</IconButton>
              </div>
            </header>

            <div className="day-list" ref={dayListRef}>
              {(currentMonth?.dayCards ?? []).map((day) => {
                const isComposing = composer?.date === day.date;
                return (
                  <article
                    key={day.date}
                    data-day-date={day.date}
                    onContextMenu={(event) => openCardMenu(event, day.date)}
                    className={
                      "daily-card" +
                      (isComposing ? " is-composing" : "") +
                      ((pendingRevealDate?.date ?? pendingRevealDate) === day.date ? " is-revealed" : "") +
                      (day.items.length > MAX_VISIBLE_TASKS ? " is-scrollable" : " is-compact")
                    }
                    style={{
                      "--scroll-height": `${getCardScrollHeight(day.items.length)}px`,
                      "--card-height": `${getCardHeight(day.items.length, isComposing)}px`,
                    }}
                  >
                    <div className={"report-rail " + (day.reportReady ? "green" : "yellow")} />
                    <div className="daily-main">
                      <div className="daily-head">
                        <div className="daily-date-line">
                          <strong>{formatDateLabel(day.date)}</strong>
                          <span>{day.weekday}</span>
                        </div>
                        <IconButton title="新增当天事项" onClick={() => openComposer(day.date)}>＋</IconButton>
                      </div>

                      <div className="daily-scroll">
                        <div className="task-list">
                          {day.items.map((item, index) => (
                            <div className="task-row" key={item.id}>
                              <span className="task-index">{index + 1}</span>
                              <span className="task-text" title={item.text}>{item.text}</span>
                              <StatusButtons
                                value={item.status}
                                onChange={(status) => updateItemStatus(day.date, item.id, status)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {composer?.date === day.date ? renderComposer() : null}
                      <footer className="daily-footer">
                        <span>共 {day.items.length} 条事项</span>
                      </footer>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="resize-grip" aria-hidden="true" onMouseDown={startResize} />
            {cardMenu ? (
              <div
                className="card-menu"
                style={{ left: `${cardMenu.x}px`, top: `${cardMenu.y}px` }}
                onPointerDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                <button type="button" onClick={() => viewCardReport(cardMenu.date)}>
                  查看日报
                </button>
                <button type="button" disabled={isGeneratingDaily(cardMenu.date)} onClick={() => regenerateCardReport(cardMenu.date)}>
                  {isGeneratingDaily(cardMenu.date) ? '生成中' : '重新生成日报'}
                </button>
                <button type="button" className="danger" onClick={() => deleteCard(cardMenu.date)}>
                  删除日期框
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  function renderComposer() {
    return (
      <div className="composer">
        <textarea
          rows="4"
          value={composer.text}
          placeholder="输入一条事项"
          onChange={(event) => setComposer((prev) => ({ ...prev, text: event.target.value }))}
        />
        <div className="composer-actions">
          <TextButton tone="dark" onClick={saveComposer}>保存</TextButton>
          <TextButton onClick={() => setComposer(null)}>取消</TextButton>
        </div>
      </div>
    );
  }

  function renderManager() {
    return (
      <main className="manager-root">
        <section className="manager-shell">
          <header className="manager-top">
            <div>
              <h1>{currentMonth ? monthTitle(currentMonth) : '暂无月份'}</h1>
              <p>按月份浏览，空白日期只保留日期数字。</p>
            </div>
            <div className="manager-actions">
              <IconButton title="上个月" onClick={previousMonth}>‹</IconButton>
              <IconButton title="下个月" onClick={nextMonth}>›</IconButton>
              <TextButton onClick={() => showScreen('settings')}>设置</TextButton>
            </div>
          </header>

          <div className="weekday-row">
            {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>

          <div className="calendar" onContextMenu={handleCalendarContextMenu}>
            {rows.map((row) => (
              <div className="calendar-row" key={row[0].iso}>
                {row.map((cell) => (
                  <button
                    key={cell.iso}
                    type="button"
                    data-day-date={cell.iso}
                    className={[
                      'date-cell',
                      cell.inMonth ? '' : 'muted',
                      cell.day ? 'has-record' : '',
                      rangeSelectionBounds && isDateBetween(cell.iso, rangeSelectionBounds[0], rangeSelectionBounds[1]) ? 'is-selected' : '',
                      rangeSelectionBounds && rangeSelectionBounds[0] === cell.iso ? 'is-range-start' : '',
                      rangeSelectionBounds && rangeSelectionBounds[1] === cell.iso ? 'is-range-end' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onPointerDown={(event) => beginRangeSelection(event, cell.iso)}
                    onContextMenu={(event) => handleDateCellContextMenu(event, cell.iso)}
                    onClick={() => handleDateCellClick(cell.iso)}
                  >
                    <div className="date-cell-title">
                      <span>{cell.dayNumber}</span>
                      {cell.day?.reportReady ? <i /> : null}
                    </div>
                    {cell.day ? (
                      <div className="date-cell-items">
                        {visibleDateItems(cell.day.items).map((item, index) =>
                          item ? (
                            <div className="date-cell-item" key={item.id}>
                              <span className="date-cell-item-index">{index + 1}.</span>
                              <span className="date-cell-item-text" title={item.text}>
                                {item.text}
                              </span>
                            </div>
                          ) : (
                            <div className="date-cell-item" key="ellipsis">
                              <span className="date-cell-more">...</span>
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <footer className="range-strip">
            {rangeGroups.map((group) => (
              <section className="range-month-group" key={group.key}>
                <header>{group.label}</header>
                <div className="range-month-list" onWheel={scrollRangeMonth}>
                  {group.reports.map((report) => (
                    <button
                      className="range-item"
                      key={report.id}
                      type="button"
                      title={`${report.title}｜${report.note}`}
                      onContextMenu={(event) => openRangeReportMenu(event, report)}
                      onClick={() => openRangeDetail(report)}
                    >
                      <time>{report.time}</time>
                      <span>{report.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </footer>
          {rangeMenu ? (
            <div
              className="range-menu"
              style={{ left: `${rangeMenu.x}px`, top: `${rangeMenu.y}px` }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button type="button" disabled={isGeneratingRange} onClick={generateRangeReport}>
                {isGeneratingRange ? '生成中' : '生成区间汇报'}
              </button>
              <button type="button" className="danger" disabled={isGeneratingRange} onClick={clearRangeSelection}>
                清除选区
              </button>
            </div>
          ) : null}
          {rangeReportMenu ? (
            <div
              className="card-menu"
              style={{ left: `${rangeReportMenu.x}px`, top: `${rangeReportMenu.y}px` }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button type="button" className="danger" onClick={() => deleteRangeReport(rangeReportMenu.reportId)}>
                删除
              </button>
            </div>
          ) : null}
          {dateMenu ? (
            <div
              className="card-menu"
              style={{ left: `${dateMenu.x}px`, top: `${dateMenu.y}px` }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button type="button" disabled={isGeneratingDaily(dateMenu.date)} onClick={() => generateDailyReport(dateMenu.date)}>
                {isGeneratingDaily(dateMenu.date) ? '生成中' : '生成日报'}
              </button>
              <button type="button" disabled={isGeneratingDaily(dateMenu.date)} onClick={() => regenerateDailyReport(dateMenu.date)}>
                {isGeneratingDaily(dateMenu.date) ? '生成中' : '重新生成日报'}
              </button>
              <button type="button" className="danger" onClick={() => deleteDateContent(dateMenu.date)}>
                删除内容
              </button>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  function renderSettings() {
    return (
      <main className="manager-root">
        <section className="settings-shell">
          <header className="manager-top">
            <div>
              <h1>设置</h1>
              <p>所有配置保持纵向排布。</p>
            </div>
            <TextButton onClick={() => showScreen('manager')}>返回管理页</TextButton>
          </header>

          <div className="setting-stack">
            <label className="setting-field">
              <span>前台悬浮窗不透明度：{settings.opacity}%</span>
              <small>左侧最低 30%，右侧最高 100%，数值越高越不透明。</small>
              <input
                type="range"
                value={settings.opacity}
                min="30"
                max="100"
                onChange={(event) => setSettings((prev) => ({ ...prev, opacity: Number(event.target.value) }))}
              />
            </label>

            <label className="setting-field">
              <span>日报生成时间</span>
              <small>软件运行期间，到达该时间会尝试生成当天日报。</small>
              <input
                type="time"
                value={settings.reportTime}
                onChange={(event) => setSettings((prev) => ({ ...prev, reportTime: event.target.value }))}
              />
            </label>

            <section className="setting-field setting-group">
              <div className="setting-field-heading">
                <div>
                  <span>AI 模型配置</span>
                  <small>支持 OpenAI API 兼容接口的模型提供方。</small>
                </div>
                <div className="model-test-actions">
                  <button
                    type="button"
                    className="model-test-btn"
                    disabled={modelTest.status === 'testing'}
                    onClick={testModelConnection}
                  >
                    {modelTest.status === 'testing' ? '测试中' : '测试连接'}
                  </button>
                </div>
              </div>
              <label className="setting-subfield">
                <span>接口地址</span>
                <input
                  value={settings.endpoint}
                  placeholder="例如：https://api.openai.com/v1"
                  onChange={(event) => updateAiSetting({ endpoint: event.target.value })}
                />
              </label>
              <label className="setting-subfield">
                <span>API Key</span>
                <div className="secret-input">
                  <input
                    type={settings.showApiKey ? 'text' : 'password'}
                    value={settings.apiKey}
                    placeholder="输入 API Key"
                    autoComplete="off"
                    onChange={(event) => updateAiSetting({ apiKey: event.target.value })}
                  />
                  <button
                    type="button"
                    className="secret-toggle"
                    title={settings.showApiKey ? '隐藏 API Key' : '显示 API Key'}
                    aria-label={settings.showApiKey ? '隐藏 API Key' : '显示 API Key'}
                    onClick={() => setSettings((prev) => ({ ...prev, showApiKey: !prev.showApiKey }))}
                  >
                    {settings.showApiKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </label>
              <label className="setting-subfield">
                <span>模型名称</span>
                <input
                  value={settings.model}
                  placeholder="例如：gpt-4.1-mini"
                  onChange={(event) => updateAiSetting({ model: event.target.value })}
                />
              </label>
              {modelTest.message ? (
                <div className={`model-test-message ${modelTest.status}`} role="status">
                  {modelTest.message}
                </div>
              ) : null}
            </section>

            <section className="setting-field">
              <span>日报复杂度</span>
              <small>选择后将使用对应的提示词控制日报篇幅。</small>
              <div className="segmented">
                {COMPLEXITY_OPTIONS.map((item) => (
                  <span className="segmented-option" key={item}>
                    <button
                      type="button"
                      className={settings.complexity === item ? 'active' : ''}
                      onClick={() => setSettings((prev) => ({ ...prev, complexity: item }))}
                    >
                      {item}
                    </button>
                  </span>
                ))}
              </div>
            </section>

            <label className="setting-field">
              <span>日报要求</span>
              <small>可以写固定栏目，也可以写“一段话总结今日工作”这类生成要求。</small>
              <textarea
                rows="8"
                value={settings.template}
                placeholder="例如：用一段话总结今日工作，语气自然简洁。"
                onChange={(event) => setSettings((prev) => ({ ...prev, template: event.target.value }))}
              />
            </label>

            <section className="setting-field setting-group">
              <div className="setting-field-heading">
                <div>
                  <span>数据备份与迁移</span>
                  <small>记录导出不包含设置；全部数据导出会包含 AI 配置和 API Key，请妥善保管。</small>
                </div>
              </div>
              <div className="data-transfer-actions">
                <button type="button" disabled={dataTransfer.status === 'testing'} onClick={() => exportJsonData('records')}>
                  记录导出
                </button>
                <button type="button" disabled={dataTransfer.status === 'testing'} onClick={() => exportJsonData('full')}>
                  全部数据导出
                </button>
                <button type="button" disabled={dataTransfer.status === 'testing'} onClick={() => importJsonData('records')}>
                  数据导入
                </button>
                <button type="button" disabled={dataTransfer.status === 'testing'} onClick={() => importJsonData('full')}>
                  全量导入
                </button>
              </div>
              {dataTransfer.message ? (
                <div className={`model-test-message ${dataTransfer.status}`} role="status">
                  {dataTransfer.message}
                </div>
              ) : null}
            </section>
          </div>
          <footer className="settings-footer">
            <strong>Dailog v{APP_VERSION}</strong>
            <span>© 2026 {APP_AUTHOR}</span>
            <p>
              使用问题或者建议请反馈
              <a
                href={GITHUB_URL}
                onClick={(event) => {
                  event.preventDefault();
                  if (window.dailog?.openExternal) {
                    window.dailog.openExternal(GITHUB_URL);
                  } else {
                    window.open(GITHUB_URL, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                {GITHUB_URL}
              </a>
            </p>
          </footer>
        </section>
      </main>
    );
  }

  function renderDetail() {
    const isRangeDetail = detail.kind === 'range';
    const reportReady = Boolean(detailDay?.reportReady);
    const reportText = getReportText(detailDay);
    const rangeSource = detailRangeLookup ?? detail;
    const rangeTitle = rangeSource?.title ?? '';
    const rangeText = detailRangeLookup?.reportText ?? detail.draftReportText ?? rangeSource?.note ?? '';
    const rangeSpan = detail.rangeStart && detail.rangeEnd ? `${formatDateLabel(detail.rangeStart)} - ${formatDateLabel(detail.rangeEnd)}` : '';

    return (
      <div className="modal-backdrop" onClick={() => setDetail(null)}>
        <section className={`detail-modal ${isRangeDetail ? 'is-range' : ''}`} onClick={(event) => event.stopPropagation()}>
          <header className="detail-top">
            <div>
              <h2>{isRangeDetail ? rangeTitle : formatDateLabel(detail.date)}</h2>
              <p>{isRangeDetail ? rangeSpan : detail.mode === 'browse' ? '浏览模式' : '编辑模式'}</p>
            </div>
            <div className="manager-actions">
              {detail.mode === 'browse' ? (
                <TextButton tone="dark" onClick={() => setDetail((prev) => ({ ...prev, mode: 'edit' }))}>
                  编辑
                </TextButton>
              ) : (
                <TextButton tone="dark" onClick={saveDetail}>保存</TextButton>
              )}
              <TextButton onClick={() => setDetail(null)}>关闭</TextButton>
            </div>
          </header>

          <div className="detail-body">
            {!isRangeDetail ? (
              <>
                <section className="detail-block">
                  <div className="detail-block-head">
                    <strong>事项</strong>
                  </div>

                  {(detail.mode === 'browse' ? detailDay?.items ?? [] : detail.draftItems).map((item) =>
                    detail.mode === 'browse' ? (
                      <div className="detail-task" key={item.id}>
                        <p>{item.text}</p>
                        <StatusIcons value={item.status} />
                      </div>
                    ) : (
                      <div className="detail-edit-row" key={item.id}>
                        <input
                          value={item.text}
                          placeholder="输入事项"
                          onChange={(event) => updateDetailItem(item.id, { text: event.target.value })}
                        />
                        <StatusButtons value={item.status} onChange={(status) => updateDetailItem(item.id, { status })} />
                      </div>
                    ),
                  )}
                </section>

                <section className="detail-block">
                  <div className="detail-block-head">
                    <strong>当日日报</strong>
                    <span className={reportReady ? 'report-dot green' : 'report-dot yellow'} />
                  </div>
                  {detail.mode === 'edit' ? (
                    <textarea
                      className="report-edit"
                      rows="7"
                      value={detail.draftReportText ?? ''}
                      placeholder="填写或修改当日日报"
                      onChange={(event) => setDetail((prev) => ({ ...prev, draftReportText: event.target.value }))}
                    />
                  ) : reportReady ? (
                    <p className="report-text">{reportText}</p>
                  ) : (
                    <div className="report-empty" />
                  )}
                </section>
              </>
            ) : (
              <>
                <section className="detail-block">
                  <div className="detail-block-head">
                    <strong>区间</strong>
                  </div>
                  <p className="range-detail-title">{rangeTitle}</p>
                  <p className="range-detail-span">{rangeSpan}</p>
                </section>

                <section className="detail-block">
                  <div className="detail-block-head">
                    <strong>区间汇报</strong>
                  </div>
                  {detail.mode === 'edit' ? (
                    <textarea
                      className="report-edit"
                      rows="9"
                      value={detail.draftReportText ?? ''}
                      placeholder="填写或修改区间汇报"
                      onChange={(event) => setDetail((prev) => ({ ...prev, draftReportText: event.target.value }))}
                    />
                  ) : rangeText ? (
                    <p className="report-text">{rangeText}</p>
                  ) : (
                    <div className="report-empty" />
                  )}
                </section>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderConfirmDialog() {
    return (
      <div className="modal-backdrop" onClick={() => closeConfirmDialog(false)}>
        <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
          <header className="confirm-top">
            <h2 id="confirm-title">{confirmDialog.title}</h2>
          </header>
          <div className="confirm-body">
            <p>{confirmDialog.message}</p>
            {confirmDialog.note ? <div className="confirm-note">{confirmDialog.note}</div> : null}
          </div>
          <footer className="confirm-actions">
            <button type="button" className="confirm-cancel" onClick={() => closeConfirmDialog(false)}>
              取消
            </button>
            <button type="button" className="confirm-primary" onClick={() => closeConfirmDialog(true)}>
              {confirmDialog.confirmText ?? '继续'}
            </button>
          </footer>
        </section>
      </div>
    );
  }
}

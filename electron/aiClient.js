export function buildChatCompletionsUrl(endpoint) {
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

function extractErrorMessage(json, text) {
  const message = json?.error?.message || json?.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  return text ? text.slice(0, 180) : '';
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

function statusHint(status) {
  if (status === 400) {
    return '请求格式或模型参数不被该接口支持';
  }
  if (status === 401 || status === 403) {
    return 'API Key 无效或没有访问权限';
  }
  if (status === 404) {
    return '接口路径或模型名称可能不正确';
  }
  if (status === 408 || status === 504) {
    return '服务响应超时';
  }
  if (status === 429) {
    return '请求被限流或额度不足';
  }
  if (status >= 500) {
    return '模型服务端异常';
  }

  return '接口返回了错误状态';
}

function summarizeNetworkError(error) {
  if (error?.name === 'AbortError') {
    return '连接超时，请检查接口地址、网络或模型服务状态。';
  }

  const message = String(error?.message || '').trim();
  if (/ENOTFOUND|getaddrinfo|fetch failed/i.test(message)) {
    return '无法访问接口地址，请检查域名、网络或代理设置。';
  }
  if (/ECONNREFUSED/i.test(message)) {
    return '接口拒绝连接，请检查服务是否已启动、端口是否正确。';
  }
  if (/certificate|SSL|TLS/i.test(message)) {
    return 'HTTPS 证书校验失败，请检查接口证书配置。';
  }

  return `连接失败：${message || '无法访问接口。'}`;
}

function normalizeConfig(config) {
  const endpoint = String(config?.endpoint || '').trim();
  const apiKey = String(config?.apiKey || '').trim();
  const model = String(config?.model || '').trim();

  if (!endpoint) {
    return { error: '请先填写接口地址。' };
  }
  if (!apiKey) {
    return { error: '请先填写 API Key。' };
  }
  if (!model) {
    return { error: '请先填写模型名称。' };
  }

  try {
    return {
      endpoint,
      apiKey,
      model,
      url: buildChatCompletionsUrl(endpoint),
    };
  } catch (error) {
    return { error: error.message || '接口地址格式不正确。' };
  }
}

async function requestChatCompletion(config, { messages, maxTokens, temperature, timeoutMs = 30000 }) {
  const normalized = normalizeConfig(config);
  if (normalized.error) {
    return { ok: false, message: normalized.error };
  }

  const { apiKey, model, url } = normalized;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    const payload = await readResponsePayload(response);
    if (!response.ok) {
      const detail = extractErrorMessage(payload.json, payload.text);
      const localizedDetail = localizeProviderError(detail);
      return {
        ok: false,
        message: `HTTP ${response.status}，${statusHint(response.status)}${localizedDetail ? `：${localizedDetail}` : '。'}`,
      };
    }

    const firstChoice = payload.json?.choices?.[0];
    const content = firstChoice?.message?.content ?? firstChoice?.text;
    if (typeof content !== 'string') {
      return {
        ok: false,
        message: '接口已连接，但返回内容不是 OpenAI Chat Completions 兼容格式，请检查接口地址是否指向 /chat/completions。',
      };
    }

    return {
      ok: true,
      content: content.trim(),
      url,
    };
  } catch (error) {
    return {
      ok: false,
      message: summarizeNetworkError(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function testModelConnection(config) {
  const result = await requestChatCompletion(config, {
    messages: [
      {
        role: 'user',
        content: '请只回复 OK，用于测试模型连通性。',
      },
    ],
    maxTokens: 8,
    temperature: 0,
    timeoutMs: 15000,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message.startsWith('HTTP') ? `连接失败：${result.message}` : result.message,
    };
  }

  return {
    ok: true,
    message: '连接成功，接口返回了 OpenAI 兼容的模型响应。',
  };
}

export async function askModelQuestion(config, question = '你是什么模型？') {
  const prompt = String(question || '').trim();
  if (!prompt) {
    return { ok: false, message: '请先填写测试内容。' };
  }

  const result = await requestChatCompletion(config, {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
    temperature: 0.2,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message.startsWith('HTTP') ? `对话失败：${result.message}` : result.message,
    };
  }

  return {
    ok: true,
    message: result.content || '模型返回了空内容。',
  };
}

export async function generateDailyReport(config, prompt) {
  const reportPrompt = String(prompt || '').trim();
  if (!reportPrompt) {
    return { ok: false, message: '日报生成失败：缺少日报提示词。' };
  }

  const result = await requestChatCompletion(config, {
    messages: [{ role: 'user', content: reportPrompt }],
    maxTokens: 900,
    temperature: 0.35,
    timeoutMs: 45000,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message.startsWith('HTTP') ? `日报生成失败：${result.message}` : result.message,
    };
  }

  return {
    ok: true,
    message: result.content || '模型返回了空内容。',
  };
}

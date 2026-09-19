const DAILY_LENGTH_RULES = {
  简单: { base: 100, step: 10, cap: 160 },
  适中: { base: 200, step: 18, cap: 300 },
  较长: { base: 300, step: 24, cap: 420 },
};

function lengthHint(complexity, itemCount) {
  const rule = DAILY_LENGTH_RULES[complexity] ?? DAILY_LENGTH_RULES.适中;
  const extraItems = Math.max(0, itemCount - 4);
  return Math.min(rule.cap, rule.base + extraItems * rule.step);
}

function normalizeReportInstruction(template) {
  const text = String(template || '').trim();
  return text || '今日完成：\n进行中：\n风险与阻塞：\n明日计划：';
}

function cleanSubtasks(item) {
  return (Array.isArray(item?.subtasks) ? item.subtasks : [])
    .map((subtask) => String(subtask?.text ?? subtask ?? '').trim())
    .filter(Boolean);
}

function statusHint(items) {
  const statuses = new Set(items.map((item) => item.status));
  const statusRules = [
    ['完成', '已完成'],
    ['进行中', '推进中未完成'],
    ['停滞', '受阻未完成'],
    ['放弃', '不再推进'],
  ];
  const hints = statusRules
    .filter(([status]) => statuses.has(status))
    .map(([status, meaning]) => `${status}=${meaning}`);
  const completionRule = statuses.has('完成')
    ? '；只有[完成]事项可写成完成/已完成'
    : '；今日无完成事项，禁止写“完成/已完成/今日完成”';

  return hints.length ? `；状态不可改写：${hints.join('，')}${completionRule}` : '';
}

function itemLinesByStatus(items) {
  const statusOrder = ['完成', '进行中', '停滞', '放弃'];
  const lines = [];

  statusOrder.forEach((status) => {
    const group = items.filter((item) => (item.status || '进行中') === status);
    if (!group.length) {
      return;
    }

    lines.push(`[${status}]`);
    group.forEach((item) => {
      const datePrefix = item.date ? `${item.date}${item.weekday ? ` ${item.weekday}` : ''}：` : '';
      lines.push(`- ${datePrefix}${String(item.text || '').trim()}`);
      cleanSubtasks(item).forEach((subtask, index) => {
        lines.push(`  进展${index + 1}: ${subtask}`);
      });
    });
  });

  return lines.join('\n');
}

function prepareItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => String(item?.text || '').trim())
    .map((item) => ({
      ...item,
      status: item.status || '进行中',
    }));
}

export function buildDailyReportPrompt({ day, settings }) {
  const items = prepareItems(day?.items);
  const complexity = settings?.complexity || '适中';
  const progressCount = items.reduce((count, item) => count + cleanSubtasks(item).length, 0);
  const limit = lengthHint(complexity, items.length + progressCount);
  const dateText = `${day?.date || ''} ${day?.weekday || ''}`.trim();

  return [
    `写中文工作日报，仅输出正文。遵守用户要求；若要求中有明确栏目/格式，只用其中栏目和顺序，不新增栏目；只依据事项与状态，不编造；篇幅${complexity}，${limit}字内${statusHint(items)}。`,
    `日期：${dateText}`,
    '用户要求：',
    normalizeReportInstruction(settings?.template),
    '事项：',
    itemLinesByStatus(items) || '无事项记录',
  ].join('\n');
}

export function buildRangeReportPrompt({ rangeStart, rangeEnd, days, settings }) {
  const items = (Array.isArray(days) ? days : []).flatMap((day) =>
    prepareItems(day?.items).map((item) => ({
      ...item,
      date: day.date,
      weekday: day.weekday,
    })),
  );
  const complexity = settings?.complexity || '适中';
  const progressCount = items.reduce((count, item) => count + cleanSubtasks(item).length, 0);
  const limit = lengthHint(complexity, items.length + progressCount);

  return [
    `写中文区间工作汇报，仅输出正文。整合归类区间内工作；遵守用户要求；若要求中有明确栏目/格式，只用其中栏目和顺序，不新增栏目；只依据事项与状态，不编造；篇幅${complexity}，${limit}字内${statusHint(items)}。`,
    `区间：${rangeStart} 至 ${rangeEnd}`,
    '用户要求：',
    normalizeReportInstruction(settings?.template),
    '事项：',
    itemLinesByStatus(items) || '无事项记录',
  ].join('\n');
}

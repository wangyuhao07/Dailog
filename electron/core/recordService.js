export const VALID_ITEM_STATUSES = ['进行中', '停滞', '完成', '放弃'];
export const DEFAULT_ITEM_STATUS = '进行中';

function toDateAtNoon(date) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isIsoDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return false;
  }

  const parsed = toDateAtNoon(date);
  return Boolean(parsed && parsed.toISOString().slice(0, 10) === date);
}

export function monthKeyFromDate(date) {
  if (!isIsoDate(date)) {
    throw new Error('日期格式不正确，请使用 YYYY-MM-DD。');
  }

  return date.slice(0, 7);
}

export function weekdayFromDate(date) {
  const parsed = toDateAtNoon(date);
  if (!parsed) {
    return '';
  }

  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parsed.getDay()];
}

export function createMonth(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('月份格式不正确，请使用 YYYY-MM。');
  }

  return {
    id: `${year}-${String(month).padStart(2, '0')}`,
    label: `${year}年${month}月`,
    year,
    monthIndex: month - 1,
    dayCards: [],
    rangeReports: [],
  };
}

export function getMonthKey(month) {
  const directKey = typeof month === 'string' ? month : month?.id;
  if (typeof directKey === 'string' && /^\d{4}-\d{1,2}$/.test(directKey)) {
    const [yearText, monthText] = directKey.split('-');
    const monthNumber = Number(monthText);
    if (monthNumber >= 1 && monthNumber <= 12) {
      return `${yearText}-${String(monthNumber).padStart(2, '0')}`;
    }
  }

  const year = Number(month?.year);
  const monthIndex = Number(month?.monthIndex);
  if (Number.isInteger(year) && Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex <= 11) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  }

  return '';
}

export function sortMonths(months) {
  return [...(Array.isArray(months) ? months : [])]
    .map((month) => ({
      month,
      key: getMonthKey(month),
    }))
    .filter(({ key }) => key)
    .map(({ month, key }) => {
      const normalized = createMonth(key);
      return {
        ...normalized,
        ...month,
        id: normalized.id,
        label: normalized.label,
        year: normalized.year,
        monthIndex: normalized.monthIndex,
        dayCards: Array.isArray(month.dayCards) ? month.dayCards : [],
        rangeReports: Array.isArray(month.rangeReports) ? month.rangeReports : [],
      };
    })
    .sort((left, right) => getMonthKey(right).localeCompare(getMonthKey(left)));
}

export function normalizeSubtasks(subtasks) {
  return (Array.isArray(subtasks) ? subtasks : [])
    .map((subtask, index) => {
      const source = typeof subtask === 'string' ? { text: subtask } : subtask;
      const text = String(source?.text ?? '').trim();
      if (!text) {
        return null;
      }

      return {
        id: String(source?.id || `subtask-${index}`),
        text,
      };
    })
    .filter(Boolean);
}

export function normalizeItem(item, index = 0) {
  const status = VALID_ITEM_STATUSES.includes(item?.status) ? item.status : DEFAULT_ITEM_STATUS;
  return {
    ...item,
    id: String(item?.id || `item-${index}`),
    text: String(item?.text ?? ''),
    status,
    subtasks: normalizeSubtasks(item?.subtasks),
  };
}

export function normalizeDay(day) {
  return {
    ...day,
    date: String(day?.date || ''),
    weekday: day?.weekday || weekdayFromDate(day?.date),
    reportReady: Boolean(day?.reportReady || String(day?.reportText || '').trim()),
    items: (Array.isArray(day?.items) ? day.items : []).map((item, index) => normalizeItem(item, index)),
  };
}

export function normalizeMonths(months) {
  return sortMonths(months).map((month) => ({
    ...month,
    dayCards: (month.dayCards ?? [])
      .map(normalizeDay)
      .filter((day) => isIsoDate(day.date))
      .sort((left, right) => left.date.localeCompare(right.date)),
    rangeReports: Array.isArray(month.rangeReports) ? month.rangeReports : [],
  }));
}

export function createDay(date) {
  if (!isIsoDate(date)) {
    throw new Error('日期格式不正确，请使用 YYYY-MM-DD。');
  }

  return {
    date,
    weekday: weekdayFromDate(date),
    reportReady: false,
    items: [],
  };
}

export function findDay(months, date) {
  for (const month of normalizeMonths(months)) {
    const day = month.dayCards.find((item) => item.date === date);
    if (day) {
      return { month, day };
    }
  }

  return null;
}

function upsertDay(months, date, updater) {
  const monthKey = monthKeyFromDate(date);
  const normalizedMonths = normalizeMonths(months);
  const hasMonth = normalizedMonths.some((month) => getMonthKey(month) === monthKey);
  const sourceMonths = hasMonth ? normalizedMonths : [...normalizedMonths, createMonth(monthKey)];

  return sortMonths(
    sourceMonths.map((month) => {
      if (getMonthKey(month) !== monthKey) {
        return month;
      }

      const existingDay = month.dayCards.find((day) => day.date === date) ?? createDay(date);
      const nextDay = normalizeDay(updater(existingDay));
      const dayCards = month.dayCards.some((day) => day.date === date)
        ? month.dayCards.map((day) => (day.date === date ? nextDay : day))
        : [...month.dayCards, nextDay];

      return {
        ...month,
        dayCards: dayCards.sort((left, right) => left.date.localeCompare(right.date)),
      };
    }),
  );
}

function assertValidStatus(status) {
  if (!VALID_ITEM_STATUSES.includes(status)) {
    throw new Error(`事项状态不正确，只能是：${VALID_ITEM_STATUSES.join('、')}。`);
  }
}

function assertNonEmptyText(text, message) {
  if (!String(text || '').trim()) {
    throw new Error(message);
  }
}

export function createItem(months, { date, text, status = DEFAULT_ITEM_STATUS }) {
  if (!isIsoDate(date)) {
    throw new Error('日期格式不正确，请使用 YYYY-MM-DD。');
  }
  assertNonEmptyText(text, '事项内容不能为空。');
  assertValidStatus(status);

  const item = normalizeItem({
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: String(text).trim(),
    status,
    subtasks: [],
  });

  return {
    months: upsertDay(months, date, (day) => ({
      ...day,
      items: [...day.items, item],
    })),
    item,
  };
}

export function updateItem(months, { date, itemId, text, status }) {
  if (!isIsoDate(date)) {
    throw new Error('日期格式不正确，请使用 YYYY-MM-DD。');
  }
  if (!itemId) {
    throw new Error('缺少事项 ID。');
  }
  if (text === undefined && status === undefined) {
    throw new Error('请至少提供事项内容或状态。');
  }
  if (status !== undefined) {
    assertValidStatus(status);
  }
  if (text !== undefined) {
    assertNonEmptyText(text, '事项内容不能为空。');
  }

  let updatedItem = null;
  const nextMonths = upsertDay(months, date, (day) => ({
    ...day,
    items: day.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      updatedItem = normalizeItem({
        ...item,
        ...(text !== undefined ? { text: String(text).trim() } : {}),
        ...(status !== undefined ? { status } : {}),
      });
      return updatedItem;
    }),
  }));

  if (!updatedItem) {
    throw new Error('没有找到对应事项。');
  }

  return { months: nextMonths, item: updatedItem };
}

export function addItemProgress(months, { date, itemId, text }) {
  if (!isIsoDate(date)) {
    throw new Error('日期格式不正确，请使用 YYYY-MM-DD。');
  }
  if (!itemId) {
    throw new Error('缺少事项 ID。');
  }
  assertNonEmptyText(text, '进展内容不能为空。');

  const subtask = {
    id: `subtask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: String(text).trim(),
  };
  let found = false;
  const nextMonths = upsertDay(months, date, (day) => ({
    ...day,
    items: day.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      found = true;
      return normalizeItem({
        ...item,
        subtasks: [...normalizeSubtasks(item.subtasks), subtask],
      });
    }),
  }));

  if (!found) {
    throw new Error('没有找到对应事项。');
  }

  return { months: nextMonths, subtask };
}

export function updateItemProgress(months, { date, itemId, subtaskId, text }) {
  if (!isIsoDate(date)) {
    throw new Error('日期格式不正确，请使用 YYYY-MM-DD。');
  }
  if (!itemId || !subtaskId) {
    throw new Error('缺少事项 ID 或进展 ID。');
  }
  assertNonEmptyText(text, '进展内容不能为空。');

  let updatedSubtask = null;
  const nextMonths = upsertDay(months, date, (day) => ({
    ...day,
    items: day.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      return normalizeItem({
        ...item,
        subtasks: normalizeSubtasks(item.subtasks).map((subtask) => {
          if (subtask.id !== subtaskId) {
            return subtask;
          }

          updatedSubtask = { ...subtask, text: String(text).trim() };
          return updatedSubtask;
        }),
      });
    }),
  }));

  if (!updatedSubtask) {
    throw new Error('没有找到对应进展。');
  }

  return { months: nextMonths, subtask: updatedSubtask };
}

function enumerateIsoDates(startDate, endDate) {
  const dates = [];
  const cursor = toDateAtNoon(startDate);
  const limit = toDateAtNoon(endDate);
  if (!cursor || !limit) {
    return dates;
  }

  while (cursor <= limit) {
    dates.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
    );
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export function collectRangeDays(months, { startDate, endDate }) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new Error('区间日期格式不正确，请使用 YYYY-MM-DD。');
  }
  if (startDate > endDate) {
    throw new Error('区间开始日期不能晚于结束日期。');
  }

  const days = [];
  let totalItems = 0;
  for (const date of enumerateIsoDates(startDate, endDate)) {
    const found = findDay(months, date);
    const items = found?.day?.items?.filter((item) => String(item?.text || '').trim()) ?? [];
    if (!items.length) {
      continue;
    }

    totalItems += items.length;
    days.push({
      ...found.day,
      items,
    });
  }

  return {
    days,
    coveredDays: days.length,
    totalItems,
  };
}

export function saveDailyReport(months, { date, reportText }) {
  if (!isIsoDate(date)) {
    throw new Error('日期格式不正确，请使用 YYYY-MM-DD。');
  }
  assertNonEmptyText(reportText, '日报内容不能为空。');

  const nextMonths = upsertDay(months, date, (day) => ({
    ...day,
    reportReady: true,
    reportText: String(reportText).trim(),
  }));

  return {
    months: nextMonths,
    day: findDay(nextMonths, date)?.day ?? null,
  };
}

function formatReportTime(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

export function saveRangeReport(months, { rangeStart, rangeEnd, reportText, note = '', generatedAt = new Date().toISOString() }) {
  if (!isIsoDate(rangeStart) || !isIsoDate(rangeEnd)) {
    throw new Error('区间日期格式不正确，请使用 YYYY-MM-DD。');
  }
  if (rangeStart > rangeEnd) {
    throw new Error('区间开始日期不能晚于结束日期。');
  }
  assertNonEmptyText(reportText, '区间汇报内容不能为空。');

  const generatedDate = new Date(generatedAt);
  const safeDate = Number.isNaN(generatedDate.getTime()) ? new Date() : generatedDate;
  const safeGeneratedAt = safeDate.toISOString();
  const report = {
    id: `range-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: formatReportTime(safeDate),
    generatedAt: safeGeneratedAt,
    title: `${formatDateLabelForReport(rangeStart)} - ${formatDateLabelForReport(rangeEnd)}汇总`,
    note: String(note || '').trim(),
    reportText: String(reportText).trim(),
    anchorDate: rangeEnd,
    rangeStart,
    rangeEnd,
  };
  const monthKey = rangeStart.slice(0, 7);
  const normalizedMonths = normalizeMonths(months);
  const hasMonth = normalizedMonths.some((month) => getMonthKey(month) === monthKey);
  const sourceMonths = hasMonth ? normalizedMonths : [...normalizedMonths, createMonth(monthKey)];
  const nextMonths = sortMonths(
    sourceMonths.map((month) => {
      if (getMonthKey(month) !== monthKey) {
        return month;
      }

      const nextReports = (month.rangeReports ?? []).filter(
        (existing) => existing.rangeStart !== rangeStart || existing.rangeEnd !== rangeEnd,
      );
      return {
        ...month,
        rangeReports: [...nextReports, report].sort(
          (left, right) => Date.parse(right.generatedAt || '') - Date.parse(left.generatedAt || ''),
        ),
      };
    }),
  );

  return { months: nextMonths, report };
}

function formatDateLabelForReport(date) {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

export function deleteItem(months, { date, itemId }) {
  if (!isIsoDate(date)) {
    throw new Error('日期格式不正确，请使用 YYYY-MM-DD。');
  }
  if (!itemId) {
    throw new Error('缺少事项 ID。');
  }

  let deletedItem = null;
  const nextMonths = upsertDay(months, date, (day) => ({
    ...day,
    items: day.items.filter((item) => {
      if (item.id === itemId) {
        deletedItem = item;
        return false;
      }

      return true;
    }),
  }));

  if (!deletedItem) {
    throw new Error('没有找到对应事项。');
  }

  return { months: nextMonths, item: deletedItem };
}

export function listDays(months, { startDate, endDate, status = '', limit = 30, offset = 0 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const days = normalizeMonths(months)
    .flatMap((month) => month.dayCards)
    .filter((day) => (!startDate || day.date >= startDate) && (!endDate || day.date <= endDate))
    .map((day) => ({
      ...day,
      items: status ? day.items.filter((item) => item.status === status) : day.items,
    }))
    .filter((day) => day.items.length || day.reportReady)
    .sort((left, right) => right.date.localeCompare(left.date));

  const pagedDays = days.slice(normalizedOffset, normalizedOffset + normalizedLimit);
  return {
    total_count: days.length,
    count: pagedDays.length,
    offset: normalizedOffset,
    days: pagedDays,
    has_more: normalizedOffset + pagedDays.length < days.length,
    next_offset: normalizedOffset + pagedDays.length < days.length ? normalizedOffset + pagedDays.length : null,
  };
}

export function listPendingItems(months, { days = 7, statuses = ['进行中', '停滞'] } = {}) {
  const allowedStatuses = new Set(statuses.filter((status) => VALID_ITEM_STATUSES.includes(status)));
  const dayLimit = Math.max(1, Math.min(90, Number(days) || 7));

  return normalizeMonths(months)
    .flatMap((month) => month.dayCards)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, dayLimit)
    .flatMap((day) =>
      day.items
        .filter((item) => allowedStatuses.has(item.status))
        .map((item) => ({
          date: day.date,
          weekday: day.weekday,
          item,
        })),
    );
}

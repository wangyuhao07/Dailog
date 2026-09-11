export const STATUS_ORDER = ['进行中', '停滞', '完成', '放弃'];

export const VIEW_TABS = [
  { id: 'floating', label: '前台悬浮窗' },
  { id: 'manager', label: '管理页' },
  { id: 'settings', label: '设置页' },
];

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function cloneMonths() {
  return [];
}

export function createMonth(monthKey) {
  const match = String(monthKey).match(/^(\d{4})-(\d{1,2})$/);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const safeYear = Number.isInteger(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1;

  return {
    id: `${safeYear}-${String(safeMonth).padStart(2, '0')}`,
    label: `${safeYear}年${safeMonth}月`,
    year: safeYear,
    monthIndex: safeMonth - 1,
    dayCards: [],
    rangeReports: [],
  };
}

function getMonthKey(month) {
  const directKey = typeof month === 'string' ? month : month?.id;
  if (typeof directKey === 'string' && /^\d{4}-\d{1,2}$/.test(directKey)) {
    const [yearText, monthText] = directKey.split('-');
    const month = Number(monthText);
    if (month >= 1 && month <= 12) {
      return `${yearText}-${String(month).padStart(2, '0')}`;
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
    .sort((left, right) => {
      const leftKey = parseMonthLabel(left);
      const rightKey = parseMonthLabel(right);
      return rightKey.localeCompare(leftKey);
    });
}

export function shiftMonthKey(monthKey, offset) {
  const key = getMonthKey(monthKey);
  const [yearText, monthText] = key.split('-');
  const date = new Date(Number(yearText), Number(monthText) - 1 + offset, 1);
  return monthKeyFromDate(date);
}

export function cycleStatus(status) {
  const index = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
}

export function monthTitle(month) {
  return month.label;
}

export function formatDateLabel(date) {
  const parsed = new Date(`${date}T12:00:00`);
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

export function weekdayFromDate(date) {
  const parsed = new Date(`${date}T12:00:00`);
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return labels[parsed.getDay()];
}

export function makeBlankDay(date) {
  return {
    date,
    weekday: weekdayFromDate(date),
    reportReady: false,
    items: [
      { id: `draft-${date}-1`, text: '', status: '进行中' },
    ],
  };
}

export function dayKey(date) {
  return date;
}

export function parseMonthLabel(month) {
  return getMonthKey(month);
}

export function buildCalendarRows(month) {
  const map = new Map(month.dayCards.map((day) => [day.date, day]));
  const first = new Date(month.year, month.monthIndex, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(month.year, month.monthIndex, 1 - offset);
  const cells = [];
  const monthKey = parseMonthLabel(month);

  for (let index = 0; index < 42; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const iso = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
    const inMonth = iso.slice(0, 7) === monthKey;
    const day = map.get(iso) || null;
    cells.push({
      iso,
      dayNumber: current.getDate(),
      inMonth,
      day,
      muted: !inMonth,
    });
  }

  const rows = [];
  for (let index = 0; index < cells.length; index += 7) {
    const row = cells.slice(index, index + 7);
    if (row.some((cell) => cell.inMonth)) {
      rows.push(row);
    }
  }

  return rows;
}

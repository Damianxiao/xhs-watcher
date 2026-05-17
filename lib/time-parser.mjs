// Parse XHS relative-time strings into absolute Date objects.
// XHS server time is China Standard Time (UTC+8). The parser is tz-independent:
// it interprets "今天 HH:MM" / "昨天 HH:MM" as the CST date of `now`, not the
// host's local date.

const CST_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 86400_000;

const PATTERNS = [
  { re: /^刚刚$/, fn: (_, now) => new Date(now) },
  { re: /^(\d+)\s*分钟前$/, fn: (m, now) => new Date(now.getTime() - Number(m[1]) * 60_000) },
  { re: /^(\d+)\s*小时前$/, fn: (m, now) => new Date(now.getTime() - Number(m[1]) * 3600_000) },
  { re: /^(\d+)\s*天前$/, fn: (m, now) => new Date(now.getTime() - Number(m[1]) * DAY_MS) },
  { re: /^(\d+)\s*周前$/, fn: (m, now) => new Date(now.getTime() - Number(m[1]) * 7 * DAY_MS) },
  { re: /^今天\s+(\d{1,2}):(\d{2})$/, fn: (m, now) => atCstDate(now, +m[1], +m[2], 0) },
  { re: /^昨天\s+(\d{1,2}):(\d{2})$/, fn: (m, now) => atCstDate(now, +m[1], +m[2], -1) },
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, fn: (m) => new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`) },
  // "MM-DD" — XHS uses this for older posts in the current CST year.
  { re: /^(\d{2})-(\d{2})$/, fn: (m, now) => {
    const yyyy = new Date(now.getTime() + CST_OFFSET_MS).getUTCFullYear();
    return new Date(`${yyyy}-${m[1]}-${m[2]}T00:00:00+08:00`);
  } },
];

// Returns a Date for (CST midnight of `now` + dayOffset days + hh:mm),
// independent of the host's local timezone.
function atCstDate(now, hh, mm, dayOffset) {
  const cstNowMs = now.getTime() + CST_OFFSET_MS;
  const cstMidnightMs = Math.floor(cstNowMs / DAY_MS) * DAY_MS - CST_OFFSET_MS;
  return new Date(cstMidnightMs + dayOffset * DAY_MS + hh * 3600_000 + mm * 60_000);
}

export function parseXhsRelativeTime(input, now = new Date()) {
  const s = String(input).trim();
  for (const { re, fn } of PATTERNS) {
    const m = s.match(re);
    if (m) return fn(m, now);
  }
  throw new Error(`unrecognized XHS time format: "${input}"`);
}

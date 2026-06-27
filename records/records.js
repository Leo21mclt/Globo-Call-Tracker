function safeSetHTML(el, htmlString, contextTag) {
  if (contextTag === 'svg') {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    el.replaceChildren(...doc.body.childNodes);
    return;
  }
  if (contextTag === 'tr') {
    const doc = new DOMParser().parseFromString('<table><tbody><tr>' + htmlString + '</tr></tbody></table>', 'text/html');
    el.replaceChildren(...doc.querySelector('tr').childNodes);
    return;
  }
  if (contextTag === 'table') {
    const doc = new DOMParser().parseFromString('<table>' + htmlString + '</table>', 'text/html');
    el.replaceChildren(...doc.querySelector('table').childNodes);
    return;
  }
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  el.replaceChildren(...doc.body.childNodes);
}
let isLocalDarkMode = false;
try {
  isLocalDarkMode = localStorage.getItem('darkMode') === 'true';
} catch (e) {
  // Silent fallback
}
if (isLocalDarkMode) {
  document.documentElement.classList.add('dark-mode');
}

const STORAGE_KEYS = {
  callLogs: "callLogs",
  settings: "settings",
  shifts: "shifts",
  weeklyShifts: "weeklyShifts"
};

const DEFAULT_SETTINGS = {
  retentionDays: 90,
  ratePerMinuteAudio: 0,
  ratePerMinuteVideo: 0,
  shiftHourlyRate: 0,
  autoAnswerEnabled: false,
  autoAnswerDelaySeconds: 5,
  darkMode: false,
  keepLoggedIn: false,
  globoDarkMode: false
};

const TZ = "America/New_York";

const FORMATTERS = {
  time12: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ }),
  time24: new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }),
  datePart: new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }),
  monthPart: new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit" }),
  localParts: new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }),
  dayLabel: new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "2-digit", year: "numeric" })
};

let pendingDeputySync = [];


const state = {
  currentYear: null,
  currentMonth: null, // 0-based
  listenersBound: false,
  currentWeekStartKey: null,
  currentEditShiftId: null
};

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_MAP = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun"
};

const MAX_WEEKLY_CACHE = 260;

function formatDayLabel(date) {
  return FORMATTERS.dayLabel.format(date);
}

function formatTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return FORMATTERS.time12.format(date);
}

function createTypeBadge(callType) {
  const badge = document.createElement("span");
  badge.className = "type-badge";
  if (callType === "video") badge.title = "Video call";
  else if (callType === "assignment") badge.title = "Assignment";
  else badge.title = "Audio call";

  const icon = document.createElement("span");
  safeSetHTML(icon, getTypeIconSvg(callType), 'svg');
  badge.append(icon);
  return badge;
}

function format12Hour(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  let hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${m} ${ampm}`;
}

function formatCurrency(value) {
  return `$${value.toFixed(2)}`;
}

function formatMinutesAndSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, Math.floor(totalSeconds % 60));
  return `${minutes} min ${String(seconds).padStart(2, "0")} sec`;
}

function showSaveBanner(message) {
  const banner = document.createElement('div');
  banner.className = 'save-banner';
  banner.textContent = message;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('show'));
  setTimeout(() => {
    banner.classList.remove('show');
    setTimeout(() => banner.remove(), 400);
  }, 2500);
}

function getLocalParts(date) {
  const parts = FORMATTERS.localParts.formatToParts(date);
  return {
    year: parts.find(p => p.type === "year").value,
    month: parts.find(p => p.type === "month").value,
    day: parts.find(p => p.type === "day").value,
    weekday: parts.find(p => p.type === "weekday").value
  };
}

function getWeekdayKey(date) {
  const parts = getLocalParts(date);
  return WEEKDAY_MAP[parts.weekday] || "mon";
}

function getWeekStartKey(date) {
  const parts = getLocalParts(date);
  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  const weekdayKey = WEEKDAY_MAP[parts.weekday] || "mon";
  const weekdayIndex = WEEKDAY_KEYS.indexOf(weekdayKey);
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  utcNoon.setUTCDate(utcNoon.getUTCDate() - weekdayIndex);
  const outY = utcNoon.getUTCFullYear();
  const outM = String(utcNoon.getUTCMonth() + 1).padStart(2, '0');
  const outD = String(utcNoon.getUTCDate()).padStart(2, '0');
  return `${outY}-${outM}-${outD}`;
}

function parseWeekStartKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function makeWeekKeyFromDate(date) {
  const parts = getLocalParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function setCurrentWeekStartKey(key) {
  state.currentWeekStartKey = key;
  const labelEl = document.getElementById("currentWeekLabel");
  if (labelEl) labelEl.textContent = formatWeekLabel(key);
}

function shiftWeek(deltaWeeks) {
  const base = state.currentWeekStartKey ? parseWeekStartKey(state.currentWeekStartKey) : new Date();
  base.setUTCDate(base.getUTCDate() + (deltaWeeks * 7));
  setCurrentWeekStartKey(makeWeekKeyFromDate(base));
}

function formatWeekLabel(weekStartKey) {
  const startDate = parseWeekStartKey(weekStartKey);
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  const startLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "2-digit"
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(endDate);
  return `${startLabel} – ${endLabel}`;
}

function buildEmptyWeek() {
  return WEEKDAY_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});
}

function generateScheduledShiftLogs(shifts, weeklyShifts) {
  const generatedLogs = [];
  const now = new Date();

  if (Array.isArray(shifts)) {
    shifts.forEach((s) => {
      if (s.recurrence === 'none' && s.startDateIso && s.startTime && s.endTime) {
        const y = parseInt(s.startDateIso.substring(0, 4), 10);
        const m = parseInt(s.startDateIso.substring(5, 7), 10) - 1;
        const d = parseInt(s.startDateIso.substring(8, 10), 10);
        
        const startParts = s.startTime.split(':');
        const endParts = s.endTime.split(':');
        
        const startMs = new Date(y, m, d, parseInt(startParts[0], 10), parseInt(startParts[1], 10)).getTime();
        let endMs = new Date(y, m, d, parseInt(endParts[0], 10), parseInt(endParts[1], 10)).getTime();
        if (endMs < startMs) {
          endMs += 24 * 60 * 60 * 1000;
        }
        
        if (endMs <= now.getTime()) {
          const durationSeconds = (endMs - startMs) / 1000;
          generatedLogs.push({
            id: `scheduled-${s.id}-${startMs}`,
            callType: "shift",
            client: s.name || "Scheduled Shift",
            callId: "-",
            startTimeMs: startMs,
            startTimeIso: new Date(startMs).toISOString(),
            endTimeMs: endMs,
            endTimeIso: new Date(endMs).toISOString(),
            durationSeconds: Math.max(0, durationSeconds),
            billableSeconds: Math.max(0, durationSeconds),
            billableMinutes: Math.max(0, Math.floor(durationSeconds / 60)),
            realMinutes: Math.max(0, Number((durationSeconds / 60).toFixed(2))),
            lostSeconds: 0,
            logType: "scheduled"
          });
        }
      }
    });
  }

  if (weeklyShifts) {
    Object.keys(weeklyShifts).forEach((weekKey) => {
      const weekData = weeklyShifts[weekKey];
      const weekStartDate = parseWeekStartKey(weekKey);
      
      WEEKDAY_KEYS.forEach((dayKey, idx) => {
        const dayShifts = weekData[dayKey] || [];
        if (!Array.isArray(dayShifts)) return;
        
        const rowDate = new Date(weekStartDate);
        rowDate.setUTCDate(weekStartDate.getUTCDate() + idx);
        
        const y = rowDate.getUTCFullYear();
        const m = rowDate.getUTCMonth();
        const d = rowDate.getUTCDate();
        
        dayShifts.forEach((shift, sIdx) => {
          if (shift.startTime && shift.endTime) {
            const startParts = shift.startTime.split(':');
            const endParts = shift.endTime.split(':');
            
            const startMs = new Date(y, m, d, parseInt(startParts[0], 10), parseInt(startParts[1], 10)).getTime();
            let endMs = new Date(y, m, d, parseInt(endParts[0], 10), parseInt(endParts[1], 10)).getTime();
            if (endMs < startMs) {
              endMs += 24 * 60 * 60 * 1000;
            }
            
            if (endMs <= now.getTime()) {
              const durationSeconds = (endMs - startMs) / 1000;
              generatedLogs.push({
                id: `weekly-${weekKey}-${dayKey}-${sIdx}-${startMs}`,
                callType: "shift",
                client: "Scheduled Shift",
                callId: "-",
                startTimeMs: startMs,
                startTimeIso: new Date(startMs).toISOString(),
                endTimeMs: endMs,
                endTimeIso: new Date(endMs).toISOString(),
                durationSeconds: Math.max(0, durationSeconds),
                billableSeconds: Math.max(0, durationSeconds),
                billableMinutes: Math.max(0, Math.floor(durationSeconds / 60)),
                realMinutes: Math.max(0, Number((durationSeconds / 60).toFixed(2))),
                lostSeconds: 0,
                logType: "scheduled"
              });
            }
          }
        });
      });
    });
  }

  return generatedLogs;
}

function cleanDayShifts(shifts) {
  if (!Array.isArray(shifts) || shifts.length <= 1) return shifts || [];

  const intervals = shifts.map(s => {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    let start = sh * 60 + sm;
    let end = eh * 60 + em;
    if (end < start) {
      end += 24 * 60;
    }
    return { start, end, original: s };
  });

  return intervals.filter((curr, index) => {
    const isEnclosed = intervals.some((other, otherIdx) => {
      if (index === otherIdx) return false;
      const encloses = other.start <= curr.start && curr.end <= other.end;
      if (encloses) {
        if (other.start === curr.start && other.end === curr.end) {
          return index > otherIdx;
        }
        return true;
      }
      return false;
    });
    return !isEnclosed;
  }).map(item => item.original);
}

function normalizeWeekData(weekData) {
  const normalized = buildEmptyWeek();
  if (!weekData || typeof weekData !== "object") return normalized;
  WEEKDAY_KEYS.forEach((dayKey) => {
    const value = weekData[dayKey];
    if (Array.isArray(value)) {
      normalized[dayKey] = value
        .filter((item) => item && item.startTime && item.endTime)
        .map((item) => ({ startTime: item.startTime, endTime: item.endTime, source: item.source }));
      return;
    }
    if (value && typeof value === "object" && value.enabled) {
      if (value.startTime && value.endTime) {
        normalized[dayKey] = [{ startTime: value.startTime, endTime: value.endTime, source: value.source }];
      }
    }
  });
  return normalized;
}



function getBillableMinutes(log) {
  if (typeof log.billableMinutes === "number") return log.billableMinutes;
  if (typeof log.billableSeconds === "number") return Math.floor(log.billableSeconds / 60);
  return 0;
}

function calcEarnings(minutes, rate) {
  return minutes * rate;
}

function getTypeIconSvg(callType) {
  if (callType === "video" || callType === "assignment") {
    return '<svg class="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v2.5l4-2.5v12l-4-2.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>';
  }
  return '<svg class="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.2a15.1 15.1 0 0 0 7.2 7.2l2.4-2.4a1 1 0 0 1 1-.24c1.1.36 2.3.55 3.5.55a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.3 21 3 13.7 3 4a1 1 0 0 1 1-1h3.7a1 1 0 0 1 1 1c0 1.2.2 2.4.6 3.5a1 1 0 0 1-.24 1l-2.5 2.7z"/></svg>';
}

function groupLogsByDay(logs) {
  return logs.reduce((acc, log) => {
    const date = new Date(log.startTimeIso || log.startTimeMs || Date.now());
    // group by local NY date
    const parts = FORMATTERS.datePart.formatToParts(date);
    const y = parts.find(p => p.type === "year").value;
    const m = parts.find(p => p.type === "month").value;
    const d = parts.find(p => p.type === "day").value;
    const key = `${y}-${m}-${d}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});
}

function getDayKeyForDate(date) {
  const parts = getLocalParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getMonthKeyForDate(date) {
  const parts = FORMATTERS.monthPart.formatToParts(date);
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  return `${y}-${m}`; // YYYY-MM
}

function setCurrentMonth(year, month0) {
  state.currentYear = year;
  state.currentMonth = month0;
  const label = document.getElementById("currentMonthLabel");
  const dt = new Date(Date.UTC(year, month0, 1, 12, 0, 0));
  const monthName = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", year: "numeric" }).format(dt);
  if (label) label.textContent = monthName;
}

function getCurrentMonthInTZ() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parseInt(parts.find(p => p.type === "year").value, 10);
  const month = parseInt(parts.find(p => p.type === "month").value, 10);
  return { year, month0: month - 1 };
}

function shiftMonth(delta) {
  let y = state.currentYear;
  let m = state.currentMonth + delta;
  if (m < 0) { m = 11; y -= 1; }
  if (m > 11) { m = 0; y += 1; }
  setCurrentMonth(y, m);
}

function calculateTotalShiftDurationForMonth(year, month0, shifts, weeklyShifts) {
  let totalMs = 0;
  if (Array.isArray(shifts)) {
    shifts.forEach((s) => {
      if (s.recurrence === 'none' && s.startDateIso && s.startTime && s.endTime) {
        const d = new Date(s.startDateIso);
        const logKey = getMonthKeyForDate(d);
        const wanted = `${year}-${String(month0 + 1).padStart(2, "0")}`;
        if (logKey === wanted) {
            const y = d.getFullYear();
            const m = d.getMonth();
            const day = d.getDate();
            const startParts = s.startTime.split(':');
            const endParts = s.endTime.split(':');
            const startMs = new Date(y, m, day, parseInt(startParts[0], 10), parseInt(startParts[1], 10)).getTime();
            let endMs = new Date(y, m, day, parseInt(endParts[0], 10), parseInt(endParts[1], 10)).getTime();
            if (endMs < startMs) {
              endMs += 24 * 60 * 60 * 1000;
            }
            totalMs += (endMs - startMs);
        }
      }
    });
  }

  if (weeklyShifts) {
    Object.keys(weeklyShifts).forEach((weekKey) => {
      const weekData = weeklyShifts[weekKey];
      const weekStartDate = parseWeekStartKey(weekKey);
      
      WEEKDAY_KEYS.forEach((dayKey, idx) => {
        const dayShifts = weekData[dayKey] || [];
        if (!Array.isArray(dayShifts)) return;
        
        const rowDate = new Date(weekStartDate);
        rowDate.setUTCDate(weekStartDate.getUTCDate() + idx);
        
        const parts = FORMATTERS.datePart.formatToParts(rowDate);
        const yStr = parts.find(p => p.type === "year").value;
        const mStr = parts.find(p => p.type === "month").value;
        const dStr = parts.find(p => p.type === "day").value;
        
        const shiftMonthKey = `${yStr}-${mStr}`;
        const wanted = `${year}-${String(month0 + 1).padStart(2, "0")}`;
        
        if (shiftMonthKey === wanted) {
          const y = parseInt(yStr, 10);
          const m = parseInt(mStr, 10) - 1;
          const d = parseInt(dStr, 10);
          
          dayShifts.forEach(shift => {
            if (shift.startTime && shift.endTime) {
              const startParts = shift.startTime.split(':');
              const endParts = shift.endTime.split(':');
              
              const startMs = new Date(y, m, d, parseInt(startParts[0], 10), parseInt(startParts[1], 10)).getTime();
              let endMs = new Date(y, m, d, parseInt(endParts[0], 10), parseInt(endParts[1], 10)).getTime();
              if (endMs < startMs) {
                endMs += 24 * 60 * 60 * 1000;
              }
              totalMs += (endMs - startMs);
            }
          });
        }
      });
    });
  }
  return totalMs;
}

function getLogStats(log) {
  const c = log._classification;
  let billableSec = log.billableSeconds || 0;
  let durationSec = log.durationSeconds || 0;
  let realMins = typeof log.realMinutes === "number" ? log.realMinutes : (durationSec / 60);

  if (c && c.mode === 'shift') {
    return { billableMins: 0, billableSec: 0, realMins: 0, lostSec: 0, durationSec };
  }
  
  if (c && c.mode === 'prorated') {
    const outSec = Math.max(0, durationSec - c.overlapSeconds);
    const bMins = Math.floor(outSec / 60);
    return {
      billableMins: bMins,
      billableSec: outSec,
      realMins: outSec / 60,
      lostSec: outSec - (bMins * 60),
      durationSec
    };
  }
  
  const bMins = getBillableMinutes(log);
  return {
    billableMins: bMins,
    billableSec: billableSec || (bMins * 60),
    realMins: realMins,
    lostSec: Math.max(0, (realMins * 60) - (bMins * 60)),
    durationSec
  };
}

function renderRecords(logs, settings, shifts, weeklyShifts) {
  const container = document.getElementById("recordsContainer");
  if (!container) return;
  const loading = document.getElementById("recordsLoading");
  if (loading) loading.style.display = "none";
  const empty = document.getElementById("recordsEmpty");
  const countEl = document.getElementById("recordCount");
  const rateAudioEl = document.getElementById("rateAudio");
  const rateVideoEl = document.getElementById("rateVideo");
  const totalMinutesEl = document.getElementById("totalBillableMinutes");
  const totalEarningsEl = document.getElementById("totalEarnings");
  const totalRealMinutesEl = document.getElementById("totalRealMinutes");
  const lostAudioEl = document.getElementById("lostAudioMinutes");
  const lostVideoEl = document.getElementById("lostVideoMinutes");
  const rateShiftEl = document.getElementById("rateShift");
  const totalShiftTimeEl = document.getElementById("totalShiftTime");

  const rateAudio = settings.ratePerMinuteAudio || 0;
  const rateVideo = settings.ratePerMinuteVideo || 0;
  const shiftHourlyRate = settings.shiftHourlyRate || 0;

  const filtered = logs.filter((log) => {
    const d = new Date(log.startTimeIso || log.startTimeMs || Date.now());
    const key = getMonthKeyForDate(d);
    const wanted = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, "0")}`;
    return key === wanted;
  });

  filtered.forEach((log) => {
    log._classification = classifyLogMode(log, shifts, weeklyShifts);
  });

  const monthShiftsMs = calculateTotalShiftDurationForMonth(state.currentYear, state.currentMonth, shifts, weeklyShifts);
  const shiftHours = monthShiftsMs / 3600000;

  const totalMinutes = filtered.reduce((sum, log) => sum + getLogStats(log).billableMins, 0);
  const totalDurationSeconds = filtered.reduce((sum, log) => sum + (getLogStats(log).realMins * 60), 0);
  
  const lostAudioSeconds = filtered.reduce((sum, log) => {
    if (log.callType !== "audio") return sum;
    return sum + getLogStats(log).lostSec;
  }, 0);
  
  const lostVideoSeconds = filtered.reduce((sum, log) => {
    if (log.callType !== "video" && log.callType !== "assignment") return sum;
    return sum + getLogStats(log).lostSec;
  }, 0);
  
  const totalEarnings = filtered.reduce((sum, log) => {
    const stats = getLogStats(log);
    const rate = (log.callType === "video" || log.callType === "assignment") ? rateVideo : rateAudio;
    return sum + calcEarnings(stats.billableMins, rate);
  }, shiftHours * shiftHourlyRate);

  if (rateAudioEl) rateAudioEl.textContent = formatCurrency(rateAudio);
  if (rateVideoEl) rateVideoEl.textContent = formatCurrency(rateVideo);
  if (rateShiftEl) rateShiftEl.textContent = `$${shiftHourlyRate.toFixed(2)}/hr`;
  if (totalShiftTimeEl) totalShiftTimeEl.textContent = `${shiftHours.toFixed(2)} hrs`;
  if (totalMinutesEl) totalMinutesEl.textContent = String(totalMinutes);
  if (totalEarningsEl) totalEarningsEl.textContent = formatCurrency(totalEarnings);
  if (totalRealMinutesEl) totalRealMinutesEl.textContent = `${(totalDurationSeconds / 60).toFixed(2)} min`;
  if (lostAudioEl) lostAudioEl.textContent = formatMinutesAndSeconds(lostAudioSeconds);
  if (lostVideoEl) lostVideoEl.textContent = formatMinutesAndSeconds(lostVideoSeconds);

  if (container) container.replaceChildren();
  if (countEl) countEl.textContent = `${filtered.length} call${filtered.length === 1 ? "" : "s"}`;

  if (!filtered.length) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  const grouped = groupLogsByDay(filtered);
  const dayKeys = Object.keys(grouped).sort((a, b) => (a < b ? 1 : -1));
  const todayKey = getDayKeyForDate(new Date());

  dayKeys.forEach((dayKey) => {
    const group = grouped[dayKey].sort((a, b) => (b.startTimeMs || 0) - (a.startTimeMs || 0));
    const [y, m, d] = dayKey.split("-");
    const dayDate = new Date(`${y}-${m}-${d}T00:00:00`);
    const dayMinutes = group.reduce((sum, log) => sum + getLogStats(log).billableMins, 0);
    const dayEarnings = group.reduce((sum, log) => {
      const stats = getLogStats(log);
      const rate = (log.callType === "video" || log.callType === "assignment") ? rateVideo : rateAudio;
      return sum + calcEarnings(stats.billableMins, rate);
    }, 0);

    const section = document.createElement("details");
    section.className = "day-group";
    section.open = dayKey === todayKey;

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = formatDayLabel(dayDate);
    const meta = document.createElement("span");
    meta.className = "day-meta";
    meta.textContent = `${dayMinutes} min • ${formatCurrency(dayEarnings)}`;
    summary.append(title, meta);

    const table = document.createElement("table");
    safeSetHTML(table, `
      <thead>
        <tr>
          <th>Start</th>
          <th>End</th>
          <th>Type</th>
          <th>Call ID</th>
          <th>Client</th>
          <th>Mode</th>
          <th>Billable</th>
          <th>Real</th>
          <th>Lost</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody></tbody>
    `, 'table');

    const tbody = table.querySelector("tbody");

    group.forEach((log) => {
      const row = document.createElement("tr");

      const startCell = document.createElement("td");
      startCell.textContent = formatTime(log.startTimeIso);

      const endCell = document.createElement("td");
      endCell.textContent = formatTime(log.endTimeIso);

      const typeCell = document.createElement("td");
      typeCell.appendChild(createTypeBadge(log.callType));

      const callIdCell = document.createElement("td");
      callIdCell.textContent = log.callId || "Unknown";

      const clientCell = document.createElement("td");
      clientCell.textContent = log.client || "Unknown";

      const stats = getLogStats(log);

      const modeCell = document.createElement("td");
      modeCell.textContent = log._classification ? (log._classification.mode.charAt(0).toUpperCase() + log._classification.mode.slice(1)) : 'Freelance';

      const billableCell = document.createElement("td");
      billableCell.textContent = `${stats.billableMins} min`;

      const originalBillableMins = getBillableMinutes(log);
      const realMinutes = typeof log.realMinutes === "number" ? log.realMinutes : ((log.durationSeconds || 0) / 60);
      
      const realCell = document.createElement("td");
      realCell.textContent = `${realMinutes.toFixed(2)} min`;

      const lostMinutes = Math.max(0, realMinutes - originalBillableMins);
      const lostCell = document.createElement("td");
      lostCell.textContent = `${lostMinutes.toFixed(2)} min`;

      const durationCell = document.createElement("td");
      durationCell.textContent = `${log.durationSeconds || 0} sec`;

      row.append(startCell, endCell, typeCell, callIdCell, clientCell, modeCell, billableCell, realCell, lostCell, durationCell);
      tbody.appendChild(row);
    });

    const content = document.createElement("div");
    content.className = "day-content";
    content.appendChild(table);

    section.append(summary, content);
    container.appendChild(section);
  });
}

  function buildCsvContent(logs) {
    const header = [
      "Call Type",
      "Client",
      "Call ID",
      "Start Time",
      "Start Rounded Time",
      "End Time",
      "End Rounded Time",
      "Duration Seconds",
      "Billable Seconds",
      "Billable Minutes",
      "Real Minutes",
      "Lost Seconds"
    ];

    const rows = logs.map((log) => [
      log.callType || "audio",
      log.client || "",
      log.callId || "",
      log.startTimeIso || "",
      log.startRoundedMs ? new Date(log.startRoundedMs).toISOString() : "",
      log.endTimeIso || "",
      log.endRoundedMs ? new Date(log.endRoundedMs).toISOString() : "",
      log.durationSeconds || 0,
      log.billableSeconds || 0,
      log.billableMinutes || 0,
      log.realMinutes || 0,
      log.lostSeconds || 0
    ]);

    return [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  function downloadCsv(csv, fileName) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function getLogsForCurrentMonth(logs) {
    const monthKey = `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, "0")}`;
    return logs.filter((log) => {
      const d = new Date(log.startTimeIso || log.startTimeMs || Date.now());
      return getMonthKeyForDate(d) === monthKey;
    });
  }

  async function exportCsv() {
    const data = await chrome.storage.local.get([STORAGE_KEYS.callLogs]);
    const logs = data[STORAGE_KEYS.callLogs] || [];

    if (!logs.length) {
      alert("No logs to export yet.");
      return;
    }

    const choice = prompt('Export which records? Type "month" for the current month or "all" for all records.', 'month');
    if (!choice) return;
    const wantsAll = choice.trim().toLowerCase() === "all";

    const exportLogs = wantsAll ? logs : getLogsForCurrentMonth(logs);
    if (!exportLogs.length) {
      alert(wantsAll ? "No logs to export yet." : "No logs for the current month.");
      return;
    }

    const csv = buildCsvContent(exportLogs);
    const suffix = wantsAll ? "all" : `${state.currentYear}-${String(state.currentMonth + 1).padStart(2, "0")}`;
    downloadCsv(csv, `globo-call-log-${suffix}.csv`);
  }

  async function clearLogs() {
    if (!confirm("Clear all saved call logs?")) return;
    await chrome.storage.local.set({
      [STORAGE_KEYS.callLogs]: []
    });
    await loadAndRender();
  }

function classifyLogMode(log, shifts, weeklyShifts) {
  try {
    const dt = new Date(log.startTimeIso || log.startTimeMs || Date.now());
    const dtEnd = new Date(log.endTimeIso || log.endTimeMs || Date.now());

    const parts = FORMATTERS.time24.formatToParts(dt);
    const hour = parts.find(p => p.type === "hour").value.padStart(2, "0");
    const minute = parts.find(p => p.type === "minute").value.padStart(2, "0");
    const timeStr = `${hour}:${minute}`;

    const endParts = FORMATTERS.time24.formatToParts(dtEnd);
    let endHour = endParts.find(p => p.type === "hour").value.padStart(2, "0");
    if (endHour === "24") endHour = "00";
    const endMinute = endParts.find(p => p.type === "minute").value.padStart(2, "0");
    let endTimeStr = `${endHour}:${endMinute}`;
    
    if (dtEnd.getDate() !== dt.getDate() || dtEnd.getMonth() !== dt.getMonth()) {
        endTimeStr = "24:00";
    }

    let dayShiftBlocks = [];

    const logKey = (() => {
      const p = FORMATTERS.datePart.formatToParts(dt);
      return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}-${p.find(x=>x.type==='day').value}`;
    })();

    for (const s of (shifts || [])) {
      if (s.recurrence === 'none' && s.startDateIso) {
        const sd = new Date(s.startDateIso);
        const sdKey = (() => {
          const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(sd);
          return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}-${p.find(x=>x.type==='day').value}`;
        })();
        if (logKey !== sdKey) continue;
      }
      if (s.startTime && s.endTime) {
        dayShiftBlocks.push({ start: s.startTime, end: s.endTime });
      }
    }

    if (weeklyShifts) {
      Object.keys(weeklyShifts).forEach((weekKey) => {
        const weekData = weeklyShifts[weekKey];
        const weekStartDate = parseWeekStartKey(weekKey);
        
        WEEKDAY_KEYS.forEach((dayKey, idx) => {
          const dayShifts = weekData[dayKey] || [];
          if (!Array.isArray(dayShifts) || dayShifts.length === 0) return;
          
          const rowDate = new Date(weekStartDate);
          rowDate.setUTCDate(weekStartDate.getUTCDate() + idx);
          
          const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(rowDate);
          const shiftKey = `${parts.find(p=>p.type==="year").value}-${parts.find(p=>p.type==="month").value}-${parts.find(p=>p.type==="day").value}`;
          
          if (shiftKey === logKey) {
            dayShifts.forEach((shift) => {
              if (shift.startTime && shift.endTime) {
                dayShiftBlocks.push({ start: shift.startTime, end: shift.endTime });
              }
            });
          }
        });
      });
    }

    if (dayShiftBlocks.length === 0) return { mode: 'freelance', overlapSeconds: 0 };

    dayShiftBlocks.sort((a, b) => a.start.localeCompare(b.start));
    let mergedBlocks = [];
    let current = dayShiftBlocks[0];
    for (let i = 1; i < dayShiftBlocks.length; i++) {
      let next = dayShiftBlocks[i];
      if (next.start <= current.end) {
        if (next.end > current.end) {
          current.end = next.end;
        }
      } else {
        mergedBlocks.push(current);
        current = next;
      }
    }
    mergedBlocks.push(current);

    const y = dt.getFullYear();
    const m = dt.getMonth();
    const d = dt.getDate();
    
    let msBlocks = mergedBlocks.map(block => {
      const startParts = block.start.split(':');
      const endParts = block.end.split(':');
      const bStartMs = new Date(y, m, d, parseInt(startParts[0], 10), parseInt(startParts[1], 10)).getTime();
      let bEndMs = new Date(y, m, d, parseInt(endParts[0], 10), parseInt(endParts[1], 10)).getTime();
      if (bEndMs < bStartMs) bEndMs += 24 * 3600 * 1000;
      return { startMs: bStartMs, endMs: bEndMs };
    });

    const callStartMs = log.startTimeMs;
    const callEndMs = log.endTimeMs;
    let overlapMs = 0;

    for (const block of msBlocks) {
      const oStart = Math.max(callStartMs, block.startMs);
      const oEnd = Math.min(callEndMs, block.endMs);
      if (oEnd > oStart) {
        overlapMs += (oEnd - oStart);
      }
    }

    const overlapSeconds = overlapMs / 1000;
    const callDuration = (callEndMs - callStartMs) / 1000;
    
    let mode = 'freelance';
    if (overlapSeconds >= callDuration - 1 && callDuration > 0) {
      mode = 'shift';
    } else if (overlapSeconds > 0) {
      mode = 'prorated';
    }

    return { mode, overlapSeconds };
  } catch (e) {
    // ignore
  }
  return { mode: 'freelance', overlapSeconds: 0 };
}

function consolidateExistingLogs(logs) {
  if (!logs || !logs.length) return { mergedLogs: [], changed: false };
  let changed = false;
  
  const groups = {};
  const mergedLogs = [];
  
  for (const log of logs) {
    if (!log.callId || log.callId === "Unknown") {
      mergedLogs.push(log);
      continue;
    }
    const key = `${log.callId}::${log.client}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(log);
  }
  
  for (const key in groups) {
    const group = groups[key];
    if (group.length === 1) {
      mergedLogs.push(group[0]);
    } else {
      changed = true;
      let minStartMs = group[0].startTimeMs;
      let maxEndMs = group[0].endTimeMs;
      
      for (let i = 1; i < group.length; i++) {
        minStartMs = Math.min(minStartMs, group[i].startTimeMs);
        maxEndMs = Math.max(maxEndMs, group[i].endTimeMs);
      }
      
      const mergedDurationSeconds = Math.max(0, Math.floor((maxEndMs - minStartMs) / 1000));
      const billableMinutes = Math.floor(mergedDurationSeconds / 60);
      const billableSeconds = billableMinutes * 60;
      const lostSeconds = Math.max(0, mergedDurationSeconds - billableSeconds);
      
      const mergedLog = {
        ...group[0],
        startTimeMs: minStartMs,
        startTimeIso: new Date(minStartMs).toISOString(),
        startRoundedMs: minStartMs - (minStartMs % 60000),
        endTimeMs: maxEndMs,
        endTimeIso: new Date(maxEndMs).toISOString(),
        endRoundedMs: maxEndMs - (maxEndMs % 60000),
        durationSeconds: mergedDurationSeconds,
        billableSeconds: billableSeconds,
        billableMinutes: billableMinutes,
        realMinutes: Number((mergedDurationSeconds / 60).toFixed(2)),
        lostSeconds: lostSeconds,
        source: "merged-retroactive"
      };
      
      mergedLogs.push(mergedLog);
    }
  }
  
  return { mergedLogs, changed };
}

async function loadAndRender() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.callLogs,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.shifts,
    STORAGE_KEYS.weeklyShifts
  ]);
  let logs = (data[STORAGE_KEYS.callLogs] || []).slice();
  
  const { mergedLogs, changed } = consolidateExistingLogs(logs);
  if (changed) {
    logs = mergedLogs;
    await chrome.storage.local.set({ [STORAGE_KEYS.callLogs]: logs });
  }

  const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.settings] || {}) };
  const shifts = data[STORAGE_KEYS.shifts] || [];
  const weeklyShifts = data[STORAGE_KEYS.weeklyShifts] || {};
  logs.sort((a, b) => (b.startTimeMs || 0) - (a.startTimeMs || 0));

  const retentionEl = document.getElementById('retentionDays');
  if (retentionEl) retentionEl.value = settings.retentionDays || DEFAULT_SETTINGS.retentionDays;
  const rateAudioEl = document.getElementById('ratePerMinuteAudio');
  if (rateAudioEl) rateAudioEl.value = settings.ratePerMinuteAudio || DEFAULT_SETTINGS.ratePerMinuteAudio;
  const rateVideoEl = document.getElementById('ratePerMinuteVideo');
  if (rateVideoEl) rateVideoEl.value = settings.ratePerMinuteVideo || DEFAULT_SETTINGS.ratePerMinuteVideo;
  const shiftRateEl = document.getElementById('shiftHourlyRate');
  if (shiftRateEl) shiftRateEl.value = settings.shiftHourlyRate || DEFAULT_SETTINGS.shiftHourlyRate;
  const autoAnswerEnabledEl = document.getElementById('autoAnswerEnabled');
  if (autoAnswerEnabledEl) autoAnswerEnabledEl.checked = settings.autoAnswerEnabled;
  const autoAnswerDelayEl = document.getElementById('autoAnswerDelaySeconds');
  if (autoAnswerDelayEl) autoAnswerDelayEl.value = settings.autoAnswerDelaySeconds;
  
  const darkModeEl = document.getElementById('darkMode');
  if (darkModeEl) darkModeEl.checked = settings.darkMode;
  
  const keepLoggedInEl = document.getElementById('keepLoggedIn');
  if (keepLoggedInEl) keepLoggedInEl.checked = settings.keepLoggedIn;
  
  const globoDarkModeEl = document.getElementById('globoDarkMode');
  if (globoDarkModeEl) globoDarkModeEl.checked = settings.globoDarkMode;
  
  document.body.classList.toggle('dark-mode', settings.darkMode);
  try {
    localStorage.setItem('darkMode', settings.darkMode ? 'true' : 'false');
  } catch (e) {
    // Silent fallback
  }

  renderRecords(logs, settings, shifts, weeklyShifts);
  renderWeeklyEditor(weeklyShifts);
  renderShiftsList(shifts, weeklyShifts);
}

function bindEvents() {
  if (state.listenersBound) return;
  state.listenersBound = true;

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const href = e.currentTarget.getAttribute('data-href');
      const target = e.currentTarget.getAttribute('data-tab');
      if (href) {
        window.location.href = href;
        return;
      }
      if (!target) return;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const panel = document.getElementById(target);
      if (panel) panel.classList.add('active');
    });
  });

  const prevBtn = document.getElementById('prevMonth');
  if (prevBtn) {
    prevBtn.addEventListener('click', async () => {
      if (state.currentYear === null) return;
      shiftMonth(-1);
      await loadAndRender();
    });
  }

  const exportBtn = document.getElementById('exportCsv');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportCsv);
  }

  const clearBtn = document.getElementById('clearLogs');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearLogs);
  }

  const nextBtn = document.getElementById('nextMonth');
  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      if (state.currentYear === null) return;
      shiftMonth(1);
      await loadAndRender();
    });
  }

  const saveBtn = document.getElementById('saveSettings');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const retention = parseInt(document.getElementById('retentionDays').value, 10);
      function parseLocalizedFloat(val) {
        if (typeof val !== 'string') val = String(val || '');
        return parseFloat(val.replace(',', '.'));
      }
      const rateA = parseLocalizedFloat(document.getElementById('ratePerMinuteAudio').value);
      const rateV = parseLocalizedFloat(document.getElementById('ratePerMinuteVideo').value);
      const shiftRate = parseLocalizedFloat(document.getElementById('shiftHourlyRate').value);
      
      const autoAnswerEnabledEl = document.getElementById('autoAnswerEnabled');
      const autoAnswerEnabled = autoAnswerEnabledEl ? autoAnswerEnabledEl.checked : false;
      const autoAnswerDelayEl = document.getElementById('autoAnswerDelaySeconds');
      const autoAnswerDelaySeconds = autoAnswerDelayEl ? parseInt(autoAnswerDelayEl.value, 10) : 5;
      const darkModeEl = document.getElementById('darkMode');
      const darkMode = darkModeEl ? darkModeEl.checked : false;
      const keepLoggedInEl = document.getElementById('keepLoggedIn');
      const keepLoggedIn = keepLoggedInEl ? keepLoggedInEl.checked : false;
      const globoDarkModeEl = document.getElementById('globoDarkMode');
      const globoDarkMode = globoDarkModeEl ? globoDarkModeEl.checked : false;

      const settings = {
        retentionDays: Number.isFinite(retention) ? retention : DEFAULT_SETTINGS.retentionDays,
        ratePerMinuteAudio: Number.isFinite(rateA) ? rateA : DEFAULT_SETTINGS.ratePerMinuteAudio,
        ratePerMinuteVideo: Number.isFinite(rateV) ? rateV : DEFAULT_SETTINGS.ratePerMinuteVideo,
        shiftHourlyRate: Number.isFinite(shiftRate) ? shiftRate : DEFAULT_SETTINGS.shiftHourlyRate,
        autoAnswerEnabled: autoAnswerEnabled,
        autoAnswerDelaySeconds: Number.isFinite(autoAnswerDelaySeconds) ? autoAnswerDelaySeconds : DEFAULT_SETTINGS.autoAnswerDelaySeconds,
        darkMode: darkMode,
        keepLoggedIn: keepLoggedIn,
        globoDarkMode: globoDarkMode
      };
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
      
      // Notify active tabs about Globo Dark Mode update
      chrome.tabs.query({ url: "*://*.globohq.com/*" }, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_GLOBO_DARK_MODE", enabled: globoDarkMode }).catch(() => {});
        }
      });

      await loadAndRender();
      showSaveBanner('Changes saved');
    });
  }

  const resetBtn = document.getElementById('resetSettings');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
      await loadAndRender();
      showSaveBanner('Settings reset to default');
    });
  }


  const prevWeekBtn = document.getElementById('prevWeek');
  if (prevWeekBtn) {
    prevWeekBtn.addEventListener('click', async () => {
      shiftWeek(-1);
      await loadAndRender();
    });
  }

  const nextWeekBtn = document.getElementById('nextWeek');
  if (nextWeekBtn) {
    nextWeekBtn.addEventListener('click', async () => {
      shiftWeek(1);
      await loadAndRender();
    });
  }

  const thisWeekBtn = document.getElementById('thisWeek');
  if (thisWeekBtn) {
    thisWeekBtn.addEventListener('click', async () => {
      setCurrentWeekStartKey(getWeekStartKey(new Date()));
      await loadAndRender();
    });
  }

  const saveWeeklyBtn = document.getElementById('saveWeekly');
  if (saveWeeklyBtn) {
    saveWeeklyBtn.addEventListener('click', async () => {
      if (!state.currentWeekStartKey) {
        setCurrentWeekStartKey(getWeekStartKey(new Date()));
      }
      const weekKey = state.currentWeekStartKey;
      const weekData = buildEmptyWeek();
      WEEKDAY_KEYS.forEach((dayKey) => {
        const block = document.querySelector(`[data-week-block="${dayKey}"]`);
        if (!block) return;
        const rows = Array.from(block.querySelectorAll('.week-shift-row'));
        const shiftsForDay = [];
        rows.forEach((row) => {
          const startTime = row.getAttribute('data-start');
          const endTime = row.getAttribute('data-end');
          const source = row.getAttribute('data-source') || undefined;
          if (startTime && endTime) {
            const shiftObj = { startTime, endTime };
            if (source) shiftObj.source = source;
            shiftsForDay.push(shiftObj);
          }
        });
        weekData[dayKey] = cleanDayShifts(shiftsForDay);
      });
      const stored = await chrome.storage.local.get([STORAGE_KEYS.weeklyShifts]);
      const weeklyShifts = stored[STORAGE_KEYS.weeklyShifts] || {};
      weeklyShifts[weekKey] = weekData;

      const keys = Object.keys(weeklyShifts).sort();
      if (keys.length > MAX_WEEKLY_CACHE) {
        const extra = keys.length - MAX_WEEKLY_CACHE;
        keys.slice(0, extra).forEach((k) => delete weeklyShifts[k]);
      }

      await chrome.storage.local.set({ [STORAGE_KEYS.weeklyShifts]: weeklyShifts });
      await loadAndRender();
      showSaveBanner('Week saved');
    });
  }

  const syncBtn = document.getElementById('syncDeputyBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing...';
      chrome.runtime.sendMessage({ action: 'SYNC_DEPUTY' }, (response) => {
        syncBtn.disabled = false;
        syncBtn.textContent = 'Sync Deputy';
        if (chrome.runtime.lastError || !response || !response.success) {
          const errMsg = chrome.runtime.lastError?.message || response?.error || 'Unknown error';
          if (errMsg === 'not_logged_in') {
            alert("You are not logged into Deputy. Opening Deputy login page now...");
            chrome.tabs.create({ url: "https://globo.na.deputy.com/" });
          } else {
            alert('Failed to sync Deputy shifts: ' + errMsg);
          }
          return;
        }
        const rawShifts = response.shifts || [];
        const unique = [];
        const seen = new Set();
        rawShifts.forEach(s => {
          const key = `${s.date}|${s.startTime}|${s.endTime}`;
          if (!seen.has(key)) { seen.add(key); unique.push(s); }
        });
        pendingDeputySync = unique;
        renderSyncPreview();
      });
    });
  }

  const cancelSyncBtn = document.getElementById('cancelSync');
  if (cancelSyncBtn) {
    cancelSyncBtn.addEventListener('click', () => {
      document.getElementById('syncPreviewModal').classList.add('hidden');
      pendingDeputySync = [];
    });
  }

  const approveSyncBtn = document.getElementById('approveSync');
  if (approveSyncBtn) {
    approveSyncBtn.addEventListener('click', async () => {
      await approveDeputySync();
    });
  }
  
  if (typeof bindEditModalEvents === 'function') {
    bindEditModalEvents();
  }
}

function renderSyncPreview() {
  const modal = document.getElementById('syncPreviewModal');
  const content = document.getElementById('syncPreviewContent');
  if (!modal || !content) return;
  
  content.replaceChildren();
  if (pendingDeputySync.length === 0) {
    safeSetHTML(content, '<p class="muted">No shifts found to sync.</p>');
  } else {
    // Group by weekKey
    const byWeek = {};
    pendingDeputySync.forEach((shift, index) => {
      const d = new Date(shift.date + "T12:00:00Z");
      const weekKey = getWeekStartKey(d);
      const dayKey = getWeekdayKey(d);
      if (!byWeek[weekKey]) byWeek[weekKey] = [];
      byWeek[weekKey].push({ ...shift, index, dayKey });
    });

    Object.keys(byWeek).sort().forEach(weekKey => {
      const weekShifts = byWeek[weekKey];
      const weekLabel = formatWeekLabel(weekKey);
      
      const weekEl = document.createElement('div');
      weekEl.className = 'preview-week';
      safeSetHTML(weekEl, `<h3>Week of ${weekLabel}</h3><div class="week-shifts"></div>`);
      const shiftsContainer = weekEl.querySelector('.week-shifts');

      weekShifts.sort((a, b) => a.date.localeCompare(b.date)).forEach(shift => {
        const d = new Date(shift.date + "T12:00:00Z");
        const dayLabel = formatDayLabel(d);
        const row = document.createElement('div');
        row.className = 'week-shift-row';
        safeSetHTML(row, `
          <div class="week-day" style="padding-bottom: 4px;">${dayLabel} <span class="badge-deputy">Deputy</span></div>
          <div style="display: flex; gap: 8px;">
            <input type="time" data-sync-index="${shift.index}" data-sync-field="start" value="${shift.startTime}" />
            <input type="time" data-sync-index="${shift.index}" data-sync-field="end" value="${shift.endTime}" />
          </div>
        `);
        shiftsContainer.appendChild(row);
      });
      content.appendChild(weekEl);
    });
  }
  
  modal.classList.remove('hidden');
}

async function approveDeputySync() {
  const modal = document.getElementById('syncPreviewModal');
  const content = document.getElementById('syncPreviewContent');
  if (!modal || !content) return;

  const approveBtn = document.getElementById('approveSync');
  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.textContent = 'Saving...';
  }

  // Update pendingDeputySync with any edits from the inputs
  pendingDeputySync.forEach((shift, index) => {
    const startEl = content.querySelector(`input[data-sync-index="${index}"][data-sync-field="start"]`);
    const endEl = content.querySelector(`input[data-sync-index="${index}"][data-sync-field="end"]`);
    if (startEl && startEl.value) shift.startTime = startEl.value;
    if (endEl && endEl.value) shift.endTime = endEl.value;
  });

  // Fetch existing weeklyShifts
  const stored = await chrome.storage.local.get([STORAGE_KEYS.weeklyShifts]);
  const weeklyShifts = stored[STORAGE_KEYS.weeklyShifts] || {};

  // Group approved shifts by weekKey
  const byWeek = {};
  pendingDeputySync.forEach(shift => {
    const d = new Date(shift.date + "T12:00:00Z");
    const weekKey = getWeekStartKey(d);
    const dayKey = getWeekdayKey(d);
    if (!byWeek[weekKey]) byWeek[weekKey] = {};
    if (!byWeek[weekKey][dayKey]) byWeek[weekKey][dayKey] = [];
    byWeek[weekKey][dayKey].push({
      startTime: shift.startTime,
      endTime: shift.endTime,
      source: shift.source
    });
  });

  // Merge into storage
  Object.keys(byWeek).forEach(weekKey => {
    if (!weeklyShifts[weekKey]) weeklyShifts[weekKey] = buildEmptyWeek();
    
    // First, remove existing deputy shifts for this week so we don't duplicate
    WEEKDAY_KEYS.forEach(dayKey => {
      const existingShifts = weeklyShifts[weekKey][dayKey] || [];
      const nonDeputy = existingShifts.filter(s => s.source !== 'deputy');
      const newShifts = byWeek[weekKey][dayKey] || [];
      
      // Combine and then clean duplicates/overlaps!
      const combined = [...nonDeputy, ...newShifts];
      weeklyShifts[weekKey][dayKey] = cleanDayShifts(combined);
    });
  });

  await chrome.storage.local.set({ [STORAGE_KEYS.weeklyShifts]: weeklyShifts });
  
  if (approveBtn) {
    approveBtn.disabled = false;
    approveBtn.textContent = 'Approve & Save';
  }
  modal.classList.add('hidden');
  pendingDeputySync = [];
  
  showSaveBanner('Deputy shifts synced');
  await loadAndRender();
}

async function init() {
  if (state.currentYear === null) {
    const current = getCurrentMonthInTZ();
    setCurrentMonth(current.year, current.month0);
  }
  if (!state.currentWeekStartKey) {
    setCurrentWeekStartKey(getWeekStartKey(new Date()));
  }
  bindEvents();
  await loadAndRender();
}

function renderWeeklyEditor(weeklyShifts) {
  const grid = document.getElementById('weeklyGrid');
  if (!grid) return;
  if (!state.currentWeekStartKey) {
    setCurrentWeekStartKey(getWeekStartKey(new Date()));
  }
  const weekKey = state.currentWeekStartKey;
  const weekData = normalizeWeekData(weeklyShifts[weekKey]);
  grid.replaceChildren();

  const startDate = parseWeekStartKey(weekKey);
  WEEKDAY_KEYS.forEach((dayKey, idx) => {
    const rowDate = new Date(startDate);
    rowDate.setUTCDate(startDate.getUTCDate() + idx);
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
      month: "2-digit",
      day: "2-digit"
    }).format(rowDate);
    const block = document.createElement('div');
    block.className = 'week-col';
    block.setAttribute('data-week-block', dayKey);
    const shifts = weekData[dayKey] || [];
    
    const shiftsHtml = shifts.length
      ? shifts.map((shift, sIdx) => {
          const startFmt = format12Hour(shift.startTime);
          const endFmt = format12Hour(shift.endTime);
          return `
            <div class="week-shift-row compact-shift shift-item" data-week="${weekKey}" data-day="${dayKey}" data-index="${sIdx}" data-start="${shift.startTime || ''}" data-end="${shift.endTime || ''}" data-source="${shift.source || ''}">
              <div class="shift-time" style="cursor:pointer; padding:6px; border-radius:4px; margin-bottom:4px; text-align:center;">${startFmt} - ${endFmt}</div>
            </div>
          `;
        }).join('')
      : '<div class="week-empty" style="text-align:center; padding:8px;">Unscheduled</div>';
      
    safeSetHTML(block, `
      <div class="week-day">${label}</div>
      <div class="week-shifts">${shiftsHtml}</div>
      <button type="button" class="week-add" data-week-add="${dayKey}">+ Add shift</button>
    `);
    grid.appendChild(block);
  });

  grid.querySelectorAll('.compact-shift').forEach((el) => {
    el.addEventListener('click', (e) => {
      const weekKey = el.getAttribute('data-week');
      const dayKey = el.getAttribute('data-day');
      const sIdx = el.getAttribute('data-index');
      const startTime = el.getAttribute('data-start');
      const endTime = el.getAttribute('data-end');
      
      const rowDate = new Date(parseWeekStartKey(weekKey));
      rowDate.setUTCDate(rowDate.getUTCDate() + WEEKDAY_KEYS.indexOf(dayKey));
      const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: '2-digit', day: '2-digit' }).format(rowDate);

      state.currentEditShiftId = "weekly-" + weekKey + "-" + dayKey + "-" + sIdx;

      document.getElementById('editShiftDate').value = dateLabel;
      document.getElementById('editShiftStart').value = startTime;
      document.getElementById('editShiftEnd').value = endTime;

      const modal = document.getElementById('editShiftModal');
      const toggleBtn = document.getElementById('editShiftToggle');
      document.getElementById('editShiftStart').disabled = true;
      document.getElementById('editShiftEnd').disabled = true;
      toggleBtn.textContent = 'Edit';
      
      modal.classList.remove('hidden');
    });
  });

  grid.querySelectorAll('[data-week-add]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const dayKey = e.currentTarget.getAttribute('data-week-add');
      const weekKey = state.currentWeekStartKey;
      
      const rowDate = new Date(parseWeekStartKey(weekKey));
      rowDate.setUTCDate(rowDate.getUTCDate() + WEEKDAY_KEYS.indexOf(dayKey));
      const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: '2-digit', day: '2-digit' }).format(rowDate);

      state.currentEditShiftId = "weekly-" + weekKey + "-" + dayKey + "-NEW";

      document.getElementById('editShiftDate').value = dateLabel;
      document.getElementById('editShiftStart').value = "";
      document.getElementById('editShiftEnd').value = "";

      const modal = document.getElementById('editShiftModal');
      const toggleBtn = document.getElementById('editShiftToggle');
      
      document.getElementById('editShiftStart').disabled = false;
      document.getElementById('editShiftEnd').disabled = false;
      toggleBtn.textContent = 'Save';
      
      modal.classList.remove('hidden');
    });
  });
}

function renderShiftsList(shifts, weeklyShifts) {
  const container = document.getElementById('shiftsList');
  if (!container) return;
  container.replaceChildren();
  
  let combinedShifts = [...(shifts || [])];
  const now = new Date();
  
  if (weeklyShifts) {
    Object.keys(weeklyShifts).forEach((weekKey) => {
      const weekData = weeklyShifts[weekKey];
      const weekStartDate = parseWeekStartKey(weekKey);
      
      WEEKDAY_KEYS.forEach((dayKey, idx) => {
        const dayShifts = weekData[dayKey] || [];
        if (!Array.isArray(dayShifts)) return;
        
        const rowDate = new Date(weekStartDate);
        rowDate.setUTCDate(weekStartDate.getUTCDate() + idx);
        
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(rowDate);
        const y = parseInt(parts.find(p => p.type === "year").value, 10);
        const m = parseInt(parts.find(p => p.type === "month").value, 10) - 1;
        const d = parseInt(parts.find(p => p.type === "day").value, 10);
        
        dayShifts.forEach((shift, sIdx) => {
          if (shift.startTime && shift.endTime) {
            const startParts = shift.startTime.split(':');
            const endParts = shift.endTime.split(':');
            
            const startMs = new Date(y, m, d, parseInt(startParts[0], 10), parseInt(startParts[1], 10)).getTime();
            let endMs = new Date(y, m, d, parseInt(endParts[0], 10), parseInt(endParts[1], 10)).getTime();
            if (endMs < startMs) {
              endMs += 24 * 60 * 60 * 1000;
            }
            
            if (endMs <= now.getTime()) {
              combinedShifts.push({
                id: `weekly-${weekKey}-${dayKey}-${sIdx}-${startMs}`,
                name: 'Scheduled Shift',
                startDateIso: new Date(startMs).toISOString(),
                startTime: shift.startTime,
                endTime: shift.endTime,
                recurrence: 'weekly'
              });
            }
          }
        });
      });
    });
  }

  combinedShifts.sort((a, b) => {
      const timeA = new Date(a.startDateIso || 0).getTime();
      const timeB = new Date(b.startDateIso || 0).getTime();
      return timeB - timeA;
  });

  if (!combinedShifts.length) {
    safeSetHTML(container, '<div class="empty">No shifts defined.</div>');
    return;
  }
  combinedShifts.forEach((s) => {
    const dateLabel = s.startDateIso
      ? new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: '2-digit', day: '2-digit' }).format(new Date(s.startDateIso))
      : 'No date';
    const isWeekly = s.recurrence === 'weekly';
    const el = document.createElement('div');
    el.className = 'shift-item';
    el.setAttribute('data-id', s.id);
    el.setAttribute('data-start', s.startTime || '');
    el.setAttribute('data-end', s.endTime || '');
    el.setAttribute('data-date', dateLabel);
    safeSetHTML(el, `
      <div class="shift-meta">
        <strong>${s.name}</strong>
        <span class="muted">${dateLabel}</span>
      </div>
      <div class="shift-time">
        ${format12Hour(s.startTime)} - ${format12Hour(s.endTime)}
      </div>
    `);
    
    // Open modal on click
    el.addEventListener('click', () => {
      state.currentEditShiftId = s.id;
      document.getElementById('editShiftDate').value = dateLabel;
      document.getElementById('editShiftStart').value = s.startTime || '';
      document.getElementById('editShiftEnd').value = s.endTime || '';
      
      const modal = document.getElementById('editShiftModal');
      const toggleBtn = document.getElementById('editShiftToggle');
      
      // Reset modal to view state
      document.getElementById('editShiftStart').disabled = true;
      document.getElementById('editShiftEnd').disabled = true;
      toggleBtn.textContent = 'Edit';
      
      modal.classList.remove('hidden');
    });
    
    container.appendChild(el);
  });
}

function bindEditModalEvents() {
  const modal = document.getElementById('editShiftModal');
  if (!modal) return;
  
  const cancelBtn = document.getElementById('editShiftCancel');
  const toggleBtn = document.getElementById('editShiftToggle');
  const deleteBtn = document.getElementById('editShiftDelete');
  
  cancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    state.currentEditShiftId = null;
  });
  
  toggleBtn.addEventListener('click', async () => {
    const startInput = document.getElementById('editShiftStart');
    const endInput = document.getElementById('editShiftEnd');
    
    if (toggleBtn.textContent === 'Edit') {
      // Switch to edit mode
      startInput.disabled = false;
      endInput.disabled = false;
      toggleBtn.textContent = 'Save';
    } else {
      // Save
      const id = state.currentEditShiftId;
      if (!id) return;
      const startTime = startInput.value;
      const endTime = endInput.value;
      
      if (!startTime || !endTime) {
        alert('Please provide start and end times.');
        return;
      }
      
      if (id.startsWith('weekly-')) {
        const parts = id.split('-');
        const weekKey = `${parts[1]}-${parts[2]}-${parts[3]}`;
        const dayKey = parts[4];
        const sIdxStr = parts[5];
        const storedWeekly = await chrome.storage.local.get([STORAGE_KEYS.weeklyShifts]);
        const weeklyShifts = storedWeekly[STORAGE_KEYS.weeklyShifts] || {};
        
        if (!weeklyShifts[weekKey]) weeklyShifts[weekKey] = {};
        if (!weeklyShifts[weekKey][dayKey]) weeklyShifts[weekKey][dayKey] = [];
        
        if (sIdxStr === "NEW") {
          weeklyShifts[weekKey][dayKey].push({ startTime, endTime });
        } else {
          const sIdx = parseInt(sIdxStr, 10);
          if (weeklyShifts[weekKey][dayKey][sIdx]) {
            weeklyShifts[weekKey][dayKey][sIdx].startTime = startTime;
            weeklyShifts[weekKey][dayKey][sIdx].endTime = endTime;
          }
        }
        weeklyShifts[weekKey][dayKey] = cleanDayShifts(weeklyShifts[weekKey][dayKey]);
        await chrome.storage.local.set({ [STORAGE_KEYS.weeklyShifts]: weeklyShifts });
      } else {
        const stored = await chrome.storage.local.get([STORAGE_KEYS.shifts]);
        const shifts = stored[STORAGE_KEYS.shifts] || [];
        const next = shifts.map(s => (s.id === id ? { ...s, startTime, endTime } : s));
        await chrome.storage.local.set({ [STORAGE_KEYS.shifts]: next });
      }
      
      modal.classList.add('hidden');
      await loadAndRender();
      showSaveBanner('Shift updated');
    }
  });
  
  deleteBtn.addEventListener('click', async () => {
    const id = state.currentEditShiftId;
    if (!id) return;
    
    const confirmText = prompt('Type delete to confirm removal.');
    if (confirmText !== 'delete') return;
    
    if (id.startsWith('weekly-')) {
      const parts = id.split('-');
      const weekKey = `${parts[1]}-${parts[2]}-${parts[3]}`;
      const dayKey = parts[4];
      const sIdx = parseInt(parts[5], 10);
      const storedWeekly = await chrome.storage.local.get([STORAGE_KEYS.weeklyShifts]);
      const weeklyShifts = storedWeekly[STORAGE_KEYS.weeklyShifts] || {};
      if (weeklyShifts[weekKey] && weeklyShifts[weekKey][dayKey]) {
        weeklyShifts[weekKey][dayKey].splice(sIdx, 1);
        await chrome.storage.local.set({ [STORAGE_KEYS.weeklyShifts]: weeklyShifts });
      }
    } else {
      const stored = await chrome.storage.local.get([STORAGE_KEYS.shifts]);
      let shifts = stored[STORAGE_KEYS.shifts] || [];
      shifts = shifts.filter(s => s.id !== id);
      await chrome.storage.local.set({ [STORAGE_KEYS.shifts]: shifts });
    }
    
    modal.classList.add('hidden');
    await loadAndRender();
    showSaveBanner('Shift removed');
  });
}

init();

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
  activeCall: "activeCall",
  callLogs: "callLogs",
  settings: "settings",
  shifts: "shifts"
};

const DEFAULT_SETTINGS = {
  retentionDays: 90,
  ratePerMinute: 0
};

const state = {
  timerId: null,
  settingsOpen: false
};

const TZ = "America/New_York";

function setSettingsOpen(open) {
  state.settingsOpen = open;
  const mainView = document.getElementById("mainView");
  if (!mainView) return;
  mainView.hidden = false;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function roundDownToMinute(ms) {
  return ms - (ms % 60000);
}

function calcBillableSeconds(startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return 0;
  const durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  return Math.floor(durationSeconds / 60) * 60;
}

function setStatusBadge(active) {
  const badge = document.getElementById("statusBadge");
  if (active) {
    badge.textContent = "Active";
    badge.classList.add("active");
    badge.classList.remove("idle");
  } else {
    badge.textContent = "Idle";
    badge.classList.remove("active");
    badge.classList.add("idle");
  }
}

function updateActiveSection(activeCall) {
  const clientEl = document.getElementById("activeClient");
  const callIdEl = document.getElementById("activeCallId");
  const startEl = document.getElementById("activeStart");
  const elapsedEl = document.getElementById("activeElapsed");
  const billableEl = document.getElementById("activeBillable");

  if (!activeCall || !activeCall.active) {
    clientEl.textContent = "-";
    callIdEl.textContent = "-";
    startEl.textContent = "-";
    elapsedEl.textContent = "00:00:00";
    billableEl.textContent = "0 min";
    setStatusBadge(false);
    return;
  }

  clientEl.textContent = activeCall.client || "Unknown";
  callIdEl.textContent = activeCall.callId || "Unknown";
  startEl.textContent = formatDateTime(activeCall.startTimeIso);

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - activeCall.startTimeMs) / 1000));
  const billableSeconds = calcBillableSeconds(activeCall.startTimeMs, Date.now());
  elapsedEl.textContent = formatDuration(elapsedSeconds);
  billableEl.textContent = `${Math.floor(billableSeconds / 60)} min`;
  setStatusBadge(true);
}

function renderLogs(logs) {
  const logsBody = document.getElementById("logsBody");
  const logsEmpty = document.getElementById("logsEmpty");
  const logsTable = document.getElementById("logsTable");
  const logsScroll = document.getElementById("logsScroll");

  logsBody.replaceChildren();

  if (!logs || logs.length === 0) {
    logsEmpty.style.display = "block";
    logsTable.style.display = "none";
    logsScroll.style.display = "none";
    return;
  }

  logsEmpty.style.display = "none";
  logsTable.style.display = "table";
  logsScroll.style.display = "block";

  logs.slice(0, 10).forEach((log) => {
    const row = document.createElement("tr");

    const startCell = document.createElement("td");
    startCell.textContent = formatDateTime(log.startTimeIso);

    const typeCell = document.createElement("td");
    typeCell.appendChild(createTypeBadge(log.callType));

    const callIdCell = document.createElement("td");
    callIdCell.textContent = log.callId || "Unknown";

    const clientCell = document.createElement("td");
    clientCell.textContent = log.client || "Unknown";
    clientCell.classList.add("truncate-client");
    clientCell.title = log.client || "Unknown";

    const billableCell = document.createElement("td");
    billableCell.textContent = `${log.billableMinutes || 0} min`;

    row.append(startCell, typeCell, callIdCell, clientCell, billableCell);
    logsBody.appendChild(row);
  });
}

function createTypeBadge(callType) {
  const badge = document.createElement("span");
  badge.className = "type-badge";
  badge.title = callType === "video" ? "Video call" : "Audio call";

  const icon = document.createElement("span");
  safeSetHTML(icon, getTypeIconSvg(callType), 'svg');
  badge.append(icon);
  return badge;
}

function getTypeIconSvg(callType) {
  if (callType === "video") {
    return '<svg class="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v2.5l4-2.5v12l-4-2.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>';
  }
  return '<svg class="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.2a15.1 15.1 0 0 0 7.2 7.2l2.4-2.4a1 1 0 0 1 1-.24c1.1.36 2.3.55 3.5.55a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.3 21 3 13.7 3 4a1 1 0 0 1 1-1h3.7a1 1 0 0 1 1 1c0 1.2.2 2.4.6 3.5a1 1 0 0 1-.24 1l-2.5 2.7z"/></svg>';
}

function updateLastUpdated() {
  const el = document.getElementById("lastUpdated");
  el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

async function refreshFromStorage() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.activeCall,
    STORAGE_KEYS.callLogs,
    STORAGE_KEYS.settings
  ]);

  updateActiveSection(data[STORAGE_KEYS.activeCall]);
  renderLogs(data[STORAGE_KEYS.callLogs] || []);

  

  const settings = data[STORAGE_KEYS.settings] || {};
  if (settings.darkMode) {
    document.body.classList.add('dark-mode');
    try {
      localStorage.setItem('darkMode', 'true');
    } catch (e) {}
  } else {
    document.body.classList.remove('dark-mode');
    try {
      localStorage.setItem('darkMode', 'false');
    } catch (e) {}
  }

  updateLastUpdated();
}

function startActiveTimer() {
  if (state.timerId) return;
  state.timerId = setInterval(async () => {
    const data = await chrome.storage.local.get([STORAGE_KEYS.activeCall]);
    updateActiveSection(data[STORAGE_KEYS.activeCall]);
  }, 1000);
}

function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEYS.activeCall] || changes[STORAGE_KEYS.callLogs]) {
      refreshFromStorage();
    }
  });
}

function toggleSettings() {
  openSettingsPage();
}

function openAllRecords() {
  const url = chrome.runtime.getURL("records.html");
  window.open(url, "_blank");
}

function openSettingsPage() {
  const url = chrome.runtime.getURL("settings.html");
  window.open(url, "_blank");
}

function openShiftsPage() {
  const url = chrome.runtime.getURL("shifts.html");
  window.open(url, "_blank");
}

function wireEvents() {
  document.getElementById("settingsToggle").addEventListener("click", toggleSettings);
  document.getElementById("openAllRecords").addEventListener("click", openAllRecords);
  document.getElementById("addShiftBtn").addEventListener("click", openShiftsPage);
}

async function init() {
  wireEvents();
  setupStorageListener();
  await refreshFromStorage();
  startActiveTimer();
  setSettingsOpen(false);

}

init();

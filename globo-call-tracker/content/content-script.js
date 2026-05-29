(function(){})("Globo Call Tracker content script loaded");

const SELECTORS = {
  panel: "#ti_panel",
  callTable: "#ti_panel table.table.table-bordered.darken",
  clientCell: "#ti_panel table tbody tr:nth-child(1) td:nth-child(2)",
  callIdCell: "#ti_panel table tbody tr:nth-child(2) td:nth-child(2)",
  endCallBtn: "#end-call-btn",
  videoApp: "#video-app",
  videoCallInfo: "#video-call-info",
  videoCallId: "#video-call-info li:nth-child(1) span"
};

const TEXT_LABELS = {
  client: "Client:",
  callId: "Call ID:",
  standby: "Please stand by for your next call"
};

const VIDEO_ACCEPT_MESSAGE = "globo-video-accept";

let videoSpyInjected = false;

const latestVideoCompanyById = {};
const videoAcceptQueue = [];
const MAX_VIDEO_ACCEPT_CACHE = 50;
let isContextInvalidated = false;

const STORAGE_KEYS = {
  activeCall: "activeCall",
  callLogs: "callLogs",
  settings: "settings"
};

const DEFAULT_SETTINGS = {
  retentionDays: 90
};

function injectVideoAcceptSpy() {
  if (videoSpyInjected) return;
  videoSpyInjected = true;
  document.documentElement.setAttribute("data-globo-call-tracker", "1");
  (function(){})("Video accept spy running via MAIN world");
}

function isInvalidatedError(error) {
  return error && String(error).includes("Extension context invalidated");
}

function markContextInvalidated(error) {
  if (isInvalidatedError(error)) {
    isContextInvalidated = true;
  }
}

async function safeStorageGet(keys) {
  if (isContextInvalidated) return {};
  try {
    return await chrome.storage.local.get(keys);
  } catch (error) {
    markContextInvalidated(error);
    return {};
  }
}

async function safeStorageSet(items) {
  if (isContextInvalidated) return;
  try {
    await chrome.storage.local.set(items);
  } catch (error) {
    markContextInvalidated(error);
  }
}

function stripLabel(text, label) {
  if (!text) return "";
  return text.replace(label, "").trim();
}

function getCallInfoFromDom() {
  if (isAudioCallActive()) {
    return getAudioCallInfoFromDom();
  }
  if (isVideoCallActive()) {
    return getVideoCallInfoFromDom();
  }
  return null;
}

function isDomCallActive() {
  return isAudioCallActive() || isVideoCallActive();
}

function debugDomState() {
  try {
    (function(){})('DOM check:', {
      audioActive: !!document.querySelector(SELECTORS.callTable) || !!document.querySelector(SELECTORS.endCallBtn),
      videoActive: !!document.querySelector(SELECTORS.videoApp) || !!document.querySelector(SELECTORS.videoCallInfo),
      selectors: SELECTORS
    });
  } catch (e) {}
}

function isAudioCallActive() {
  const callTable = document.querySelector(SELECTORS.callTable);
  const endCallBtn = document.querySelector(SELECTORS.endCallBtn);
  return !!callTable || !!endCallBtn;
}

function isVideoCallActive() {
  const videoApp = document.querySelector(SELECTORS.videoApp);
  const callInfo = document.querySelector(SELECTORS.videoCallInfo);
  return !!videoApp || !!callInfo;
}

function getAudioCallInfoFromDom() {
  const clientCell = document.querySelector(SELECTORS.clientCell);
  const callIdCell = document.querySelector(SELECTORS.callIdCell);
  (function(){})('getAudioCallInfoFromDom selectors', { clientCellExists: !!clientCell, callIdCellExists: !!callIdCell });
  if (!clientCell || !callIdCell) return null;

  const clientText = stripLabel(clientCell.textContent || "", TEXT_LABELS.client);
  const callIdText = stripLabel(callIdCell.textContent || "", TEXT_LABELS.callId);

  if (!clientText && !callIdText) return null;

  return {
    callType: "audio",
    client: clientText || "Unknown",
    callId: callIdText || "Unknown"
  };
}

function getVideoCallInfoFromDom() {
  const callIdSpan = document.querySelector(SELECTORS.videoCallId);
  (function(){})('getVideoCallInfoFromDom selector', { callIdSpanExists: !!callIdSpan });
  const callIdText = callIdSpan ? (callIdSpan.textContent || "").trim() : "";
  const resolvedCallId = callIdText;
  const companyName = getLatestVideoCompanyForCall(resolvedCallId);

  if (!resolvedCallId && !isVideoCallActive()) return null;

  return {
    callType: "video",
    client: companyName || "Video Call",
    callId: resolvedCallId || "Unknown"
  };
}

function getLatestVideoCompanyForCall(callId) {
  if (!callId) {
    if (videoAcceptQueue.length > 0) return videoAcceptQueue[0].companyName;
    return "";
  }
  const lookup = String(callId).trim();
  if (latestVideoCompanyById[lookup]) return latestVideoCompanyById[lookup];
  const match = videoAcceptQueue.find((item) => {
    if (!item || !item.companyName) return false;
    return (
      item.uniqueId === lookup ||
      item.numericId === lookup ||
      item.roomName === lookup ||
      (item.roomName && item.roomName.indexOf(lookup) !== -1) ||
      (lookup && lookup.indexOf(item.numericId) !== -1)
    );
  });
  return match ? match.companyName : "";
}

function recordVideoAcceptPayload(payload) {
  if (!payload || !payload.companyName) return;
  const uniqueId = payload.uniqueId || "";
  const numericId = payload.numericId || "";
  const roomName = payload.roomName || "";

  if (uniqueId) latestVideoCompanyById[uniqueId] = payload.companyName;
  if (numericId) latestVideoCompanyById[numericId] = payload.companyName;
  if (roomName) latestVideoCompanyById[roomName] = payload.companyName;

  videoAcceptQueue.unshift({
    companyName: payload.companyName,
    uniqueId,
    numericId,
    roomName,
    receivedAt: Date.now()
  });

  if (videoAcceptQueue.length > MAX_VIDEO_ACCEPT_CACHE) {
    videoAcceptQueue.length = MAX_VIDEO_ACCEPT_CACHE;
  }

  (function(){})('Video accept payload received', {
    companyName: payload.companyName,
    uniqueId,
    numericId,
    roomName
  });
}

function consumeVideoAcceptPayload(payloadOrId) {
  if (!payloadOrId) return;
  const matchIds = [];
  if (typeof payloadOrId === "string") {
    matchIds.push(payloadOrId);
  } else if (payloadOrId && typeof payloadOrId === "object") {
    if (payloadOrId.uniqueId) matchIds.push(payloadOrId.uniqueId);
    if (payloadOrId.numericId) matchIds.push(payloadOrId.numericId);
    if (payloadOrId.roomName) matchIds.push(payloadOrId.roomName);
  }
  matchIds.forEach((id) => {
    delete latestVideoCompanyById[id];
  });
  const idx = videoAcceptQueue.findIndex((item) => {
    return matchIds.includes(item.uniqueId) || matchIds.includes(item.numericId) || matchIds.includes(item.roomName);
  });
  if (idx >= 0) videoAcceptQueue.splice(idx, 1);
}

function resetVideoNameCacheForNewCall(callInfo) {
  if (!callInfo || callInfo.callType !== "video") return;
  const cutoff = Date.now() - 10000;
  for (let i = videoAcceptQueue.length - 1; i >= 0; i -= 1) {
    const item = videoAcceptQueue[i];
    if (item.receivedAt < cutoff) {
      if (item.uniqueId) delete latestVideoCompanyById[item.uniqueId];
      if (item.numericId) delete latestVideoCompanyById[item.numericId];
      if (item.roomName) delete latestVideoCompanyById[item.roomName];
      videoAcceptQueue.splice(i, 1);
    }
  }
}

function installVideoAcceptListener() {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;
    
    if (data.type === VIDEO_ACCEPT_MESSAGE) {
      const payload = data.payload || {};
      recordVideoAcceptPayload(payload);
      updateActiveCallFromVideoAccept({
        companyName: payload.companyName,
        callId: payload.uniqueId || payload.numericId || payload.roomName
      });
    } else if (data.type === "globo-assignment-start") {
      const payload = data.payload || {};
      startAssignmentCall(payload);
    }
  });

  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('.swal2-confirm.btn-success');
    if (btn && btn.textContent.trim().toLowerCase() === "complete") {
      const popup = e.target.closest('.swal2-popup');
      if (popup && popup.textContent.includes("Did you finish your assignment")) {
        const data = await safeStorageGet([STORAGE_KEYS.activeCall]);
        const activeCall = data[STORAGE_KEYS.activeCall];
        if (activeCall && activeCall.active && activeCall.callType === "assignment") {
          await endCallIfActive("assignment-complete");
        }
      }
    }
  });
}

async function startAssignmentCall(payload) {
  if (isContextInvalidated) return;
  const data = await safeStorageGet([STORAGE_KEYS.activeCall]);
  const activeCall = data[STORAGE_KEYS.activeCall];
  
  const callId = payload.uniqueId || payload.numericId;
  const nextCallKey = `assignment:${callId}`;

  if (activeCall && activeCall.active && activeCall.callKey === nextCallKey) {
    return;
  }

  if (activeCall && activeCall.active) {
    await endCallIfActive("new-assignment-started");
  }

  const startTimeMs = payload.startTimeStr ? new Date(payload.startTimeStr).getTime() : Date.now();
  const nextActive = {
    active: true,
    callType: "assignment",
    client: payload.companyName || "Unknown Client",
    callId: callId,
    callKey: nextCallKey,
    startTimeMs: startTimeMs,
    startTimeIso: new Date(startTimeMs).toISOString(),
  };

  await safeStorageSet({ [STORAGE_KEYS.activeCall]: nextActive });
  (function(){})('Started active assignment', nextActive);
}

async function updateActiveCallFromVideoAccept({ companyName, callId }) {
  if (isContextInvalidated) return;
  const data = await safeStorageGet([STORAGE_KEYS.activeCall]);
  const activeCall = data[STORAGE_KEYS.activeCall];
  if (!activeCall || !activeCall.active || activeCall.callType !== "video") return;

  if (!callId) return;

  // If active call has unknown ID, assign from payload.
  if (!activeCall.callId || activeCall.callId === "Unknown") {
    const nextActive = { ...activeCall, callId, callKey: `video:${callId}` };
    if (companyName) nextActive.client = companyName;
    await safeStorageSet({ [STORAGE_KEYS.activeCall]: nextActive });
    (function(){})('Video call ID assigned from payload', { callId, companyName });
    if (companyName) consumeVideoAcceptPayload({ uniqueId: callId });
    return;
  }

  // If payload doesn't match, try to match newest record by active callId.
  if (activeCall.callId !== callId) {
    const matchedName = getLatestVideoCompanyForCall(activeCall.callId);
    if (matchedName && (activeCall.client === "Video Call" || activeCall.client === "Unknown")) {
      const nextActive = { ...activeCall, client: matchedName };
      await safeStorageSet({ [STORAGE_KEYS.activeCall]: nextActive });
      (function(){})('Video client matched by queued payload', { callId: activeCall.callId, matchedName });
      consumeVideoAcceptPayload({ uniqueId: activeCall.callId });
    }
    return;
  }

  let changed = false;
  const nextActive = { ...activeCall };

  if (companyName && (activeCall.client === "Video Call" || activeCall.client === "Unknown")) {
    nextActive.client = companyName;
    changed = true;
  }

  if (changed) {
    await safeStorageSet({ [STORAGE_KEYS.activeCall]: nextActive });
    (function(){})('Updated active video call from accept payload', nextActive);
    consumeVideoAcceptPayload({ uniqueId: callId });
  }
}

function getDashboardDataFromScript() {
  const scripts = Array.from(document.querySelectorAll("script"));
  for (const script of scripts) {
    const content = script.textContent || "";
    if (!content.includes("LinguistDashboardApp")) continue;

    const match = content.match(
      /renderComponent\("linguist_dashboard_app_component",\s*"LinguistDashboardApp",\s*(\{[\s\S]*\})\s*\)/
    );
    if (!match || !match[1]) continue;

    try {
      return JSON.parse(match[1]);
    } catch (error) {
      return null;
    }
  }
  return null;
}

function getStandbyText() {
  const panel = document.querySelector(SELECTORS.panel);
  if (!panel) return "";
  return (panel.textContent || "").trim();
}

async function getSettings() {
  const data = await safeStorageGet([STORAGE_KEYS.settings]);
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.settings] || {}) };
}

function pruneLogs(logs, retentionDays) {
  if (!Array.isArray(logs)) return [];
  if (!retentionDays || retentionDays <= 0) return logs;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return logs.filter((log) => (log.endTimeMs || 0) >= cutoff);
}

function roundDownToMinute(ms) {
  return ms - (ms % 60000);
}

function calcBillableSeconds(startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return 0;
  const durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  return Math.floor(durationSeconds / 60) * 60;
}

async function startCallIfNeeded(source, exactEndTimeMs = null) {
  if (isContextInvalidated) return;
  const domActive = isDomCallActive();
  debugDomState();
  if (!domActive) return;

  let callInfo = getCallInfoFromDom();
  if (!callInfo) return;

  if (callInfo.callType === "video" && callInfo.callId && (callInfo.client === "Video Call" || callInfo.client === "Unknown")) {
    const matchedName = getLatestVideoCompanyForCall(callInfo.callId);
    if (matchedName) {
      callInfo = { ...callInfo, client: matchedName };
      consumeVideoAcceptPayload(callInfo.callId);
    }
  }

  const data = await safeStorageGet([STORAGE_KEYS.activeCall]);
  const activeCall = data[STORAGE_KEYS.activeCall];

  if (activeCall && activeCall.active) {
    const nextCallKey = `${callInfo.callType}:${callInfo.callId}`;
    if (activeCall.callKey === nextCallKey) {
      return;
    }
    if (
      activeCall.callType === callInfo.callType &&
      activeCall.callId === "Unknown" &&
      callInfo.callId !== "Unknown"
    ) {
      const nextCallData = {
        ...activeCall,
        callId: callInfo.callId,
        callKey: nextCallKey
      };
      if (activeCall.client === "Video Call" || activeCall.client === "Unknown" || activeCall.client === "Unknown Client") {
        nextCallData.client = callInfo.client;
      }
      await safeStorageSet({
        [STORAGE_KEYS.activeCall]: nextCallData
      });
      return;
    }
    await endCallIfActive("call-changed", exactEndTimeMs);
  }

  resetVideoNameCacheForNewCall(callInfo);

  const now = Date.now();
  const nextActive = {
    active: true,
    source,
    callType: callInfo.callType,
    callKey: `${callInfo.callType}:${callInfo.callId}`,
    client: callInfo.client,
    callId: callInfo.callId,
    startTimeMs: now,
    startTimeIso: new Date(now).toISOString()
  };

  await safeStorageSet({
    [STORAGE_KEYS.activeCall]: nextActive
  });
  (function(){})('Started active call', nextActive);
}

async function endCallIfActive(source, exactEndTimeMs = null) {
  if (isContextInvalidated) return;
  const data = await safeStorageGet([STORAGE_KEYS.activeCall, STORAGE_KEYS.callLogs]);
  const activeCall = data[STORAGE_KEYS.activeCall];
  if (!activeCall || !activeCall.active) return;

  const now = exactEndTimeMs || Date.now();
  const durationSeconds = Math.max(0, Math.floor((now - activeCall.startTimeMs) / 1000));
  const billableSeconds = calcBillableSeconds(activeCall.startTimeMs, now);
  const billableMinutes = Math.floor(billableSeconds / 60);
  const lostSeconds = Math.max(0, durationSeconds - billableSeconds);

  const logEntry = {
    id: `${activeCall.startTimeMs}-${activeCall.callId}`,
    callType: activeCall.callType || "audio",
    client: activeCall.client,
    callId: activeCall.callId,
    startTimeMs: activeCall.startTimeMs,
    startTimeIso: activeCall.startTimeIso,
    startRoundedMs: roundDownToMinute(activeCall.startTimeMs),
    endTimeMs: now,
    endTimeIso: new Date(now).toISOString(),
    endRoundedMs: roundDownToMinute(now),
    durationSeconds,
    billableSeconds,
    billableMinutes,
    realMinutes: Number((durationSeconds / 60).toFixed(2)),
    lostSeconds,
    source
  };

  const logs = Array.isArray(data[STORAGE_KEYS.callLogs]) ? data[STORAGE_KEYS.callLogs] : [];
  const settings = await getSettings();
  const nextLogs = pruneLogs([logEntry, ...logs], settings.retentionDays);

  await safeStorageSet({
    [STORAGE_KEYS.activeCall]: { active: false },
    [STORAGE_KEYS.callLogs]: nextLogs
  });
  (function(){})('Ended active call', logEntry);
}

let endCallTimeoutId = null;
let tentativeEndTimeMs = null;

async function handleDomStateChange(source) {
  if (isContextInvalidated) return;
  const data = await safeStorageGet([STORAGE_KEYS.activeCall]);
  const activeCall = data[STORAGE_KEYS.activeCall];

  if (isDomCallActive()) {
    const passedEndTimeMs = tentativeEndTimeMs;
    if (endCallTimeoutId) {
      clearTimeout(endCallTimeoutId);
      endCallTimeoutId = null;
    }
    tentativeEndTimeMs = null;
    await startCallIfNeeded(source, passedEndTimeMs);
  } else {
    if (activeCall && activeCall.active && activeCall.callType === "assignment") {
      return;
    }
    if (!endCallTimeoutId && activeCall && activeCall.active) {
      tentativeEndTimeMs = Date.now();
      endCallTimeoutId = setTimeout(async () => {
        endCallTimeoutId = null;
        if (!isDomCallActive()) {
          const latestData = await safeStorageGet([STORAGE_KEYS.activeCall]);
          const latestCall = latestData[STORAGE_KEYS.activeCall];
          if (latestCall && latestCall.active && latestCall.callType !== "assignment") {
            await endCallIfActive(source, tentativeEndTimeMs);
          }
        }
      }, 5000);
    }
  }
}

async function reconcileState() {
  if (isContextInvalidated) return;
  const domActive = isDomCallActive();
  const standbyText = getStandbyText();
  const data = await safeStorageGet([STORAGE_KEYS.activeCall]);
  const activeCall = data[STORAGE_KEYS.activeCall];

  if (domActive) {
    if (endCallTimeoutId) {
      clearTimeout(endCallTimeoutId);
      endCallTimeoutId = null;
    }
    await startCallIfNeeded("dom-reconcile");
    return;
  }

  if (standbyText.includes(TEXT_LABELS.standby) && activeCall && activeCall.active) {
    if (activeCall.callType !== "assignment") {
      await endCallIfActive("dom-standby");
    }
  }
}

function setupObserver() {
  const panel = document.querySelector(SELECTORS.panel);
  if (!panel) return false;

  const observer = new MutationObserver(() => {
    if (isContextInvalidated) {
      observer.disconnect();
      return;
    }
    handleDomStateChange("dom-mutation");
  });

  observer.observe(panel, {
    childList: true,
    subtree: true,
    characterData: true
  });

  return true;
}

function startPollingFallback() {
  const intervalId = setInterval(() => {
    if (isContextInvalidated) {
      clearInterval(intervalId);
      return;
    }
    handleDomStateChange("dom-poll");
  }, 2000);
}

let autoAnswerEnabled = false;
let autoAnswerDelaySeconds = 5;
let autoAnswerTimerId = null;

async function syncSettings() {
  if (isContextInvalidated) return;
  const data = await safeStorageGet([STORAGE_KEYS.settings]);
  const settings = data[STORAGE_KEYS.settings] || {};
  autoAnswerEnabled = settings.autoAnswerEnabled === true;
  autoAnswerDelaySeconds = typeof settings.autoAnswerDelaySeconds === 'number' ? settings.autoAnswerDelaySeconds : 5;
}

function handleAutoAnswerState() {
  if (!autoAnswerEnabled) return;
  
  const acceptBtn = document.querySelector('.modal-swal-confirms .swal2-confirm');
  if (acceptBtn && acceptBtn.offsetParent !== null) {
    if (!autoAnswerTimerId && !acceptBtn.dataset.autoAnswering) {
      acceptBtn.dataset.autoAnswering = "true";
      let secondsLeft = autoAnswerDelaySeconds;
      
      const originalText = acceptBtn.innerText;
      acceptBtn.innerText = `${originalText} (${secondsLeft}s)`;
      
      autoAnswerTimerId = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
          clearInterval(autoAnswerTimerId);
          autoAnswerTimerId = null;
          (function(){})('Auto-answering call via simulated click');
          acceptBtn.click();
        } else {
          acceptBtn.innerText = `${originalText} (${secondsLeft}s)`;
        }
      }, 1000);
    }
  } else {
    if (autoAnswerTimerId) {
      clearInterval(autoAnswerTimerId);
      autoAnswerTimerId = null;
    }
  }
}

function setupAutoAnswerObserver() {
  const observer = new MutationObserver(() => {
    if (isContextInvalidated) {
      observer.disconnect();
      return;
    }
    handleAutoAnswerState();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });
}

function setupSettingsListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEYS.settings]) {
      syncSettings();
    }
  });
}

async function init() {
  (function(){})('Globo Call Tracker content script initializing');
  injectVideoAcceptSpy();
  installVideoAcceptListener();
  
  await syncSettings();
  setupSettingsListener();
  setupAutoAnswerObserver();
  
  if (isContextInvalidated) return;
  await reconcileState();

  if (!setupObserver()) {
    startPollingFallback();
    return;
  }

  startPollingFallback();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

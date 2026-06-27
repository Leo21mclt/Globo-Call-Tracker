chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SYNC_DEPUTY') {
    runDeputySync()
      .then(shifts => sendResponse({ success: true, shifts }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async
  }
});

async function runDeputySync() {
  // 1. Create a tab
  const tab = await chrome.tabs.create({ url: "https://globo.na.deputy.com/#/", active: false });
  
  try {
    // 2. Wait for it to load
    await waitForTabComplete(tab.id);

    // 3. Send message to scrape current week
    const currentWeekRes = await sendMessageWithRetry(tab.id, { action: 'EXTRACT_DEPUTY_DATA' });
    if (!currentWeekRes || !currentWeekRes.success) {
      throw new Error(currentWeekRes?.error || "Failed to scrape current week");
    }
    
    // 4. Send message to click next week and scrape
    const nextWeekRes = await sendMessageWithRetry(tab.id, { action: 'DEPUTY_NEXT_WEEK' });
    if (!nextWeekRes || !nextWeekRes.success) {
      throw new Error(nextWeekRes?.error || "Failed to scrape next week");
    }

    // 5. Combine and return
    return [...currentWeekRes.shifts, ...nextWeekRes.shifts];

  } finally {
    // 6. Close the tab
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForTabComplete(tabId, inactivityTimeoutMs = 30000, maxTotalTimeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let inactivityTimer;
    let maxTotalTimer;
    
    function cleanUp() {
      chrome.tabs.onUpdated.removeListener(updateListener);
      chrome.tabs.onRemoved.removeListener(removeListener);
      clearTimeout(inactivityTimer);
      clearTimeout(maxTotalTimer);
    }
    
    function resetInactivityTimer() {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        cleanUp();
        reject(new Error("Loading timed out due to inactivity (no responses from tab for 30 seconds)"));
      }, inactivityTimeoutMs);
    }
    
    function updateListener(tId, info) {
      if (tId === tabId) {
        resetInactivityTimer();
        if (info.status === 'complete') {
          cleanUp();
          resolve();
        }
      }
    }
    
    function removeListener(tId) {
      if (tId === tabId) {
        cleanUp();
        reject(new Error("Tab was closed by the user or browser"));
      }
    }
    
    chrome.tabs.onUpdated.addListener(updateListener);
    chrome.tabs.onRemoved.addListener(removeListener);
    
    // Start timers
    resetInactivityTimer();
    maxTotalTimer = setTimeout(() => {
      cleanUp();
      reject(new Error("Sync timed out: Deputy page failed to load within 2 minutes"));
    }, maxTotalTimeoutMs);
  });
}

function sendMessageWithRetry(tabId, message, maxRetries = 10) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function trySend() {
      attempts++;
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          if (attempts >= maxRetries) {
            reject(new Error("Content script not responding: " + chrome.runtime.lastError.message));
          } else {
            setTimeout(trySend, 500); // Wait 500ms and try again
          }
        } else {
          resolve(response);
        }
      });
    }
    // Initial delay to let content scripts load after tab complete
    setTimeout(trySend, 1000); 
  });
}

// Keep Alive Heartbeat Alarms Logic
async function syncKeepAliveAlarm() {
  const data = await chrome.storage.local.get(['settings']);
  const settings = data.settings || {};
  const enabled = settings.keepLoggedIn === true;
  
  if (enabled) {
    chrome.alarms.get('keepAliveAlarm', (alarm) => {
      if (!alarm) {
        chrome.alarms.create('keepAliveAlarm', { periodInMinutes: 5 });
      }
    });
  } else {
    chrome.alarms.clear('keepAliveAlarm');
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAliveAlarm') {
    chrome.tabs.query({ url: ["*://*.globohq.com/*", "*://globohq.com/*"] }, (tabs) => {
      if (tabs && tabs.length > 0) {
        const origins = new Set();
        tabs.forEach(tab => {
          try {
            const url = new URL(tab.url);
            origins.add(url.origin);
          } catch (e) {}
        });
        origins.forEach(origin => {
          fetch(`${origin}/session_timeout/keep_current_session_alive.js`, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          }).catch(() => {});
        });
      }
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    syncKeepAliveAlarm().catch(() => {});
  }
});

// Run keep-alive configuration checks immediately upon background service worker load/wakeup.
syncKeepAliveAlarm().catch(() => {});


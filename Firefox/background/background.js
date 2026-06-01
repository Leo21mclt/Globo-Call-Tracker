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
    const currentWeekRes = await sendMessageWithRetry(tab.id, { action: 'SCRAPE_DEPUTY' });
    if (!currentWeekRes || !currentWeekRes.success) {
      throw new Error(currentWeekRes?.error || "Failed to scrape current week");
    }
    
    // 4. Send message to click next week and scrape
    const nextWeekRes = await chrome.tabs.sendMessage(tab.id, { action: 'DEPUTY_NEXT_WEEK' });
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

function waitForTabComplete(tabId) {
  return new Promise(resolve => {
    chrome.tabs.onUpdated.addListener(function listener(tId, info) {
      if (tId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
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

// UPDATE CHECKER
const REPO_OWNER = "Leo21mclt";
const REPO_NAME = "Globo-Call-Tracker";

async function checkForUpdates() {
  try {
    const manifest = chrome.runtime.getManifest();
    const currentVersion = manifest.version;

    const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`);
    if (!response.ok) return;

    const release = await response.json();
    let latestVersion = release.tag_name;
    if (latestVersion.startsWith("v") || latestVersion.startsWith("V")) {
      latestVersion = latestVersion.substring(1);
    }
    
    // Simple version comparison (assumes format x.y.z)
    if (latestVersion && latestVersion !== currentVersion) {
      const v1 = currentVersion.split('.').map(Number);
      const v2 = latestVersion.split('.').map(Number);
      
      let isNewer = false;
      for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
        const n1 = v1[i] || 0;
        const n2 = v2[i] || 0;
        if (n2 > n1) { isNewer = true; break; }
        if (n2 < n1) { break; }
      }

      if (isNewer) {
        chrome.storage.local.set({ 
          updateAvailable: {
            version: release.tag_name,
            url: release.html_url
          }
        });
      }
    }
  } catch (err) {
    console.error("Update check failed", err);
  }
}

chrome.runtime.onStartup.addListener(checkForUpdates);
chrome.runtime.onInstalled.addListener(() => {
  checkForUpdates();
  chrome.alarms.create("checkUpdateAlarm", { periodInMinutes: 1440 }); // Check daily
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkUpdateAlarm") {
    checkForUpdates();
  }
});

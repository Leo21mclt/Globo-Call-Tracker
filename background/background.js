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

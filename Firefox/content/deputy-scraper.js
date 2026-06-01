/**
 * Injected into globo.na.deputy.com to scrape shifts
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SCRAPE_DEPUTY') {
    scrapeWithRetry()
      .then(shifts => sendResponse({ success: true, shifts }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'DEPUTY_NEXT_WEEK') {
    const nextBtn = document.querySelector('.js-myWeek-control[data-direction="right"]');
    if (!nextBtn) {
      sendResponse({ success: false, error: "Next button not found" });
      return;
    }

    // Remember the currently visible start date
    const currentFirstAvatar = document.querySelector('.my-week-day__avatars .js-myWeek-avatar');
    const oldDate = currentFirstAvatar ? currentFirstAvatar.getAttribute('data-my-week-day') : null;

    nextBtn.click();

    waitForDOMUpdate(oldDate)
      .then(() => scrapeWithRetry())
      .then(shifts => sendResponse({ success: true, shifts }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true;
  }
});

function waitForDOMUpdate(oldDate, maxWaitMs = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let loaderSeen = false;

    const interval = setInterval(() => {
      if (Date.now() - startTime > maxWaitMs) {
        clearInterval(interval);
        resolve(); // Resolve anyway, it might have loaded instantly
        return;
      }

      const loader = document.querySelector('.m-loader');
      const isLoading = loader && loader.offsetParent !== null;

      if (isLoading) {
        loaderSeen = true;
      } else if (loaderSeen && !isLoading) {
        clearInterval(interval);
        resolve();
      } else {
        const currentFirstAvatar = document.querySelector('.my-week-day__avatars .js-myWeek-avatar');
        if (currentFirstAvatar) {
          const newDate = currentFirstAvatar.getAttribute('data-my-week-day');
          if (oldDate && newDate !== oldDate) {
            clearInterval(interval);
            resolve();
            return;
          }
        }
        // Fallback: If 1000ms passed with no loader and no date change detected (e.g. empty week), assume done
        if (Date.now() - startTime > 1000) {
          clearInterval(interval);
          resolve();
        }
      }
    }, 100);
  });
}

function scrapeWithRetry(maxWaitMs = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    function tryScrape() {
      if (Date.now() - startTime > maxWaitMs) {
        return reject(new Error("Timeout waiting for shifts container"));
      }

      // Check if we are on a login page
      const isLoginPage = document.querySelector('#deputec_login') || 
                          document.querySelector('input[type="password"]') ||
                          window.location.href.includes('/login');
      
      if (isLoginPage) {
        return reject(new Error("not_logged_in"));
      }

      const container = document.querySelector('#my-week.m-myWeek');
      if (!container) {
        setTimeout(tryScrape, 200);
        return;
      }

      // If there's a loader overlay visible, wait
      const loader = document.querySelector('.m-loader');
      if (loader && loader.offsetParent !== null) {
        setTimeout(tryScrape, 200);
        return;
      }

      try {
        const shifts = doScrape();
        resolve(shifts);
      } catch (err) {
        reject(err);
      }
    }

    tryScrape();
  });
}

function doScrape() {
  const days = Array.from(document.querySelectorAll('li.m-myWeek-item'));
  const results = [];

  // 1. Find an anchor date from any avatar in the week
  let anchorDateStr = null;
  let anchorDayIndex = -1;
  
  for (let i = 0; i < days.length; i++) {
    const dayEl = days[i];
    const avatar = dayEl.querySelector('.my-week-day__avatars .js-myWeek-avatar');
    if (avatar && avatar.getAttribute('data-my-week-day')) {
      anchorDateStr = avatar.getAttribute('data-my-week-day');
      const idMatch = dayEl.id.match(/my-week-day-(\d)/);
      anchorDayIndex = idMatch ? parseInt(idMatch[1], 10) : i;
      break; // found our anchor
    }
  }

  // If we absolutely can't find an anchor, we can't safely extract dates
  if (!anchorDateStr) return [];

  // Parse anchor date at Noon UTC to prevent timezone drift
  const anchorParts = anchorDateStr.split('-');
  const anchorDate = new Date(Date.UTC(anchorParts[0], anchorParts[1] - 1, anchorParts[2], 12, 0, 0));

  days.forEach((dayEl, index) => {
    // Determine the index of this day (0 for Monday, 6 for Sunday usually)
    const idMatch = dayEl.id.match(/my-week-day-(\d)/);
    const dayIndex = idMatch ? parseInt(idMatch[1], 10) : index;

    // Calculate this column's exact date by comparing it to the anchor
    const diffDays = dayIndex - anchorDayIndex;
    const colDate = new Date(anchorDate);
    colDate.setUTCDate(colDate.getUTCDate() + diffDays);
    
    const y = colDate.getUTCFullYear();
    const m = String(colDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(colDate.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    // Find all shift items (roster or timesheet) inside this day. Exclude open shifts.
    const shiftEls = dayEl.querySelectorAll('.js-roster-item, .js-timesheet-item');
    
    shiftEls.forEach(shiftEl => {
      // It must not be an open shift
      if (shiftEl.closest('.js-available-shift-item')) return;

      // Extract time e.g. "8am - 12pm"
      const timeStrong = shiftEl.querySelector('.m-rosterCard-text > strong');
      if (!timeStrong) return;

      const timeText = timeStrong.textContent.trim();
      const times = parseShiftTimeStr(timeText);
      if (times) {
        results.push({
          date: dateStr,
          startTime: times.start,
          endTime: times.end,
          source: 'deputy'
        });
      }
    });
  });

  return results;
}

function parseShiftTimeStr(str) {
  // Matches "8am - 12pm" or "8:30am - 12:00pm"
  const regex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
  const match = str.match(regex);
  if (!match) return null;

  function to24Hour(hourStr, minuteStr, ampm) {
    let h = parseInt(hourStr, 10);
    const m = parseInt(minuteStr || "0", 10);
    if (ampm.toLowerCase() === 'pm' && h < 12) h += 12;
    if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  return {
    start: to24Hour(match[1], match[2], match[3]),
    end: to24Hour(match[4], match[5], match[6])
  };
}

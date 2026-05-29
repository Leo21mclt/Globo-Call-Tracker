# Globo Call Tracker (MVP)

This Chrome extension auto-detects calls on the Globo linguist dashboard and logs billable minutes.

## Install (Developer Mode)
1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this folder: `globo-call-tracker`.

## How it works
- Runs only on: https://www.globohq.com/linguist_dashboard/index
- Detects when the call details table appears in `#ti_panel`.
- Detects video calls when `#video-app` or `#video-call-info` appears.
- Starts a timer, captures client name + call ID.
- Stops when the table disappears or standby text returns.
- Saves a log with billable minutes (rounded down to full minutes).

## Popup
- Shows current call status, elapsed time, and billable minutes.
- Exports CSV of saved logs.
- Retention setting (default: 90 days).

## Notes
- If the page reloads mid-call, the extension will reconcile by checking the DOM state.
- No audio or video access is required; this is DOM-based detection only.

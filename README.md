# Globo Call Tracker - Version 2.0.9

A Chrome Extension designed to seamlessly track calls, log billable minutes, manage shifts, calculate earnings, and sync schedules with Deputy for Globo linguists.

## 1. Installation Instructions

Since this is a custom extension not hosted on the Chrome Web Store, it must be installed manually via Chrome's Developer Mode.

1. Download the extension folder (unzip it if it's a `.zip` file).
2. Open Google Chrome.
3. Click the three dots (menu) in the top-right corner.
4. Go to **Extensions > Manage Extensions** (or type `chrome://extensions/` in the URL bar).
5. In the top right corner, toggle **Developer mode** to **ON**.
6. Click the **Load unpacked** button that appears in the top left.
7. Select the unzipped `globo-call-tracker` folder.
8. The extension is now installed! You can pin it to your toolbar by clicking the puzzle piece icon next to the address bar.

## 2. Features & Functions

- **Auto-Tracking**: Automatically tracks start time, duration, and billable minutes for Video and Audio calls directly from the Globo Dashboard.
- **Smart Auto-Answer**: Automatically clicks "Accept" on incoming call popups after a user-defined delay.
- **Shift Management**: Manually log custom shifts outside of regular tracked calls. Includes a weekly visual shift planner.
- **Deputy Sync**: Send your logged weekly shifts directly to your Deputy schedule with a single click.
- **Earnings Calculator**: Automatically calculates your estimated earnings based on logged minutes/shifts and custom pay rates.
- **Dark Mode**: Sleek, fully-integrated dark mode for comfortable viewing in low-light environments.

## 3. Correct Usage

- **Tracking Calls**: Simply keep the [Globo Linguist Dashboard](https://www.globohq.com/linguist_dashboard/index) open. The extension silently monitors in the background. When a call starts, it begins tracking elapsed time. When the call ends, it saves the record permanently.
- **The Popup**: Click the extension icon in Chrome to view the status of your active call, start a manual shift, or quickly glance at your 5 most recent calls.
- **Full Records**: Click "All Records" in the popup to open the comprehensive dashboard. Here you can filter calls by month, view total statistics, calculate earnings, manage weekly shifts, and access settings.

## 4. Configuring Settings (Rates & Auto-Answer)

To configure the extension, go to the Records Dashboard and click the **Settings** tab in the sidebar.

- **Pay Rates**: Enter your pay rate per minute for both Audio and Video calls, and your hourly rate for shifts. This allows the "Earnings" tab to accurately estimate your paycheck.
- **Auto-Answer**: Toggle this feature **ON** to automatically accept incoming calls. You can customize the delay (in seconds) to give yourself a moment to prepare before the extension picks up the call.
- **Appearance**: Toggle Dark Mode **ON** or **OFF** to change the theme of the extension interface.

## 5. Deputy Sync

You can synchronize your logged "Weekly Shifts" directly to Deputy.

> [!CAUTION]
> **CRITICAL REQUIREMENT:**
> For the "Sync Deputy" button to work, you MUST be actively logged into your Deputy account on the same browser. 

1. Open a new tab and log in to [https://my.deputy.com](https://my.deputy.com).
2. Once logged in, return to the **Shifts** tab in the Globo Call Tracker Records page.
3. Click **Sync Deputy**. The extension will use your active session to push the shifts to your schedule.

## 6. Updating the Extension

The extension will automatically check GitHub for updates and show a banner in the popup if a new version is available.

To update **without losing your saved records**:
1. Make sure you are **NOT** currently on an active call. 
2. Download the new version `.zip` file from GitHub and unzip it.
3. Copy the contents of the new folder and paste them into your **CURRENT** installation folder, choosing *"Replace files in the destination"* when Windows asks.
4. Go to `chrome://extensions/` in Chrome.
5. Find the "Globo Call Tracker" extension and click the small circular **Reload** arrow icon.
6. Refresh any open Globo Dashboard tabs to apply the new code.

*Your records will be perfectly preserved!*

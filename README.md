# ReelGuard — Chrome Extension
### Instagram Reels Doomscrolling Reducer · Manifest V3 MVP

---

## File Structure

```
reel-guard/
├── manifest.json       — Extension config (MV3)
├── background.js       — Service worker: storage, counting logic, cooldown alarms
├── content.js          — Injected into Instagram: reel detection, HUD, blocking
├── content.css         — Styles for the HUD and block overlay
├── popup.html          — Settings popup UI
├── popup.js            — Popup logic
├── popup.css           — Popup styles
├── icons/
│   ├── icon16.png      — You must add these (see below)
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## ⚠️ Icons Setup (Required)

Chrome extensions require PNG icon files. Since this repo doesn't include binary files, create them:

**Option A — Quick placeholder:**
1. Open `icon_source.svg` (included) in a browser
2. Screenshot and crop to 16×16, 48×48, 128×128 px
3. Save as `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

**Option B — Generate programmatically:**
```bash
mkdir icons
# If you have ImageMagick installed:
convert -size 128x128 xc:'#111111' -fill '#52b788' \
  -font Helvetica-Bold -pointsize 80 -gravity center \
  -annotate 0 '⏸' icons/icon128.png
convert icons/icon128.png -resize 48x48 icons/icon48.png
convert icons/icon128.png -resize 16x16 icons/icon16.png
```

**Option C — Omit icons for demo:**
Remove the `"icons"` section from `manifest.json`. Chrome will use a default icon.

---

## Loading into Chrome (Unpacked Extension)

1. Open Chrome and go to: `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `reel-guard/` folder (the folder containing `manifest.json`)
5. The extension appears in your toolbar. Pin it for easy access.

---

## Testing on Instagram Web

1. Open Chrome and navigate to `https://www.instagram.com/`
2. Log in if needed
3. Click **Reels** in the left sidebar (or go to `instagram.com/reels/`)
4. Start scrolling through Reels (swipe up or use keyboard)

**What to observe:**
- A small dark HUD appears in the **bottom-right corner** of the screen counting your Reels
- The progress bar fills as you watch more
- At **75% of your limit** (default: 15/20), the HUD pulses orange as a warning
- At **100% of your limit** (20/20), a full-screen block overlay appears with a countdown timer
- The block overlay has an "Override & Reset Session" button that requires a confirmation dialog

**Testing the block quickly:**
1. Click the extension icon to open the popup
2. Set the Reel limit to **3** and click Save
3. Watch 3 Reels — the block should trigger

**Resetting:**
- Open the popup and click **Reset Session** at any time
- Or wait for the cooldown timer to expire (default: 5 minutes)

---

## Architecture Notes

### Reel Detection Strategy
The extension polls `window.location.href` every 800ms and extracts the reel ID from URLs matching `/reels/XXXX/`. When the ID changes, a new Reel is counted. This is the simplest viable approach because:
- Instagram's DOM structure changes frequently (brittle for scraping)
- URL changes are reliable and stable
- Works regardless of whether reels autoplay or are manually scrolled

**Assumption:** Each unique URL segment after `/reels/` represents a distinct Reel. This is true for Instagram web as of 2024–2025.

### Session vs. Persistent Storage
Session data (`sessionCount`, `sessionStart`, `blockedAt`) is stored in `chrome.storage.local`. It persists across tab refreshes but can be reset via the popup. There is no automatic session expiry in this MVP — the user resets manually or after a block cooldown.

---

## Known Limitations / Fragile Parts

1. **Instagram DOM changes:** If Instagram changes its URL structure for Reels (e.g., moves away from `/reels/ID/`), detection breaks. The REEL_URL_RE regex needs updating.

2. **No cross-tab coordination:** If the user opens Instagram in two tabs, counts are incremented from both, which may cause double-counting or race conditions.

3. **Service worker lifecycle:** MV3 service workers can be killed by Chrome. The background script re-initializes on the next message, but alarm-based unblocking is handled by Chrome's alarm API and survives service worker restarts.

4. **Block bypass:** A technically savvy user can: open DevTools and delete `blockedAt` from `chrome.storage.local`, or disable the extension. This is intentional for an MVP — the friction is behavioral, not technical.

5. **Reel "watched" definition:** We count a reel as watched when the URL changes. If a user skips through reels quickly, each URL change is counted. If they rewatch the same reel, it's not double-counted (same ID). Going back to a previous reel does re-count it.

6. **Session not time-based:** The session doesn't reset automatically at midnight or after X hours. A power user could leave Instagram open and resume the next day on the same session.

7. **No sync across devices:** Counts are local to the Chrome profile. The extension only works on desktop Chrome, not mobile.

---

## Suggested Next-Step Improvements (Post-MVP)

### 1. Auto Session Reset at Midnight
Add a `chrome.alarms.create` alarm that fires at midnight and calls `resetSession()`. This makes "session" match the user's natural mental model of a day.

### 2. Daily History / Usage Graph
Store a rolling 7-day history of `{date, count}` in `chrome.storage.local`. Show a small sparkline chart in the popup so users see their trends over time — this adds the awareness layer that makes behavior change stick.

### 3. Mindful Pause Before Counting
Instead of immediately counting a URL change as a "watched" Reel, start a 5-second timer. If the user stays on the Reel for 5+ seconds, count it. This filters accidental swipes and makes the count more meaningful. Implement by adding a `pendingReelId` that's confirmed after a `setTimeout`.

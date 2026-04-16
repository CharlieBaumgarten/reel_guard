// ============================================================
// background.js — Service Worker
// Handles storage coordination and cooldown alarm management.
// ============================================================

// Default settings used when the extension is first installed.
const DEFAULTS = {
  enabled: true,
  reelLimit: 20,
  sessionCount: 0,
  sessionStart: null,       // timestamp (ms) when this session began
  blockedAt: null,          // timestamp (ms) when the block was triggered
  cooldownMinutes: 5        // how long the lockout lasts
};

// On install, initialize storage with defaults if not already set.
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(null);
  const merged = { ...DEFAULTS, ...existing };
  await chrome.storage.local.set(merged);
  console.log('[ReelGuard] Installed. Storage initialized.');
});

// ============================================================
// Message handler — content script sends messages here.
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'INCREMENT_REEL') {
    // Called each time a new Reel is detected.
    handleIncrementReel().then(sendResponse);
    return true; // keep channel open for async response
  }

  if (msg.type === 'GET_STATE') {
    // Content script requests the full current state on load.
    chrome.storage.local.get(null).then(sendResponse);
    return true;
  }

  if (msg.type === 'RESET_SESSION') {
    // Popup or content script requests a full session reset.
    resetSession().then(sendResponse);
    return true;
  }

  if (msg.type === 'UPDATE_SETTINGS') {
    // Popup updates limit or enabled flag.
    chrome.storage.local.set(msg.payload).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ============================================================
// Core logic: increment count and evaluate thresholds.
// ============================================================
async function handleIncrementReel() {
  const state = await chrome.storage.local.get(null);

  // Don't count if extension is disabled.
  if (!state.enabled) return { action: 'DISABLED' };

  // Don't count if already blocked.
  if (state.blockedAt) return { action: 'BLOCKED', state };

  // Start session timer if this is the first reel.
  const sessionStart = state.sessionStart || Date.now();
  const sessionCount = (state.sessionCount || 0) + 1;
  const limit = state.reelLimit || DEFAULTS.reelLimit;

  const updates = { sessionCount, sessionStart };

  let action = 'COUNTED';

  // Check warning threshold: 75% of limit.
  const warnAt = Math.floor(limit * 0.75);
  if (sessionCount >= limit) {
    // Trigger block.
    updates.blockedAt = Date.now();
    action = 'BLOCKED';
    // Schedule alarm to auto-lift block after cooldown.
    const cooldownMs = (state.cooldownMinutes || DEFAULTS.cooldownMinutes) * 60 * 1000;
    chrome.alarms.create('unblock', { delayInMinutes: state.cooldownMinutes || DEFAULTS.cooldownMinutes });
    console.log(`[ReelGuard] Limit reached (${sessionCount}/${limit}). Blocked for ${state.cooldownMinutes} min.`);
  } else if (sessionCount >= warnAt) {
    action = 'WARN';
  }

  await chrome.storage.local.set(updates);
  const newState = await chrome.storage.local.get(null);
  return { action, state: newState };
}

// ============================================================
// Cooldown alarm: lifts the block after the cooldown period.
// ============================================================
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'unblock') {
    // Reset the blocked state but keep session count — they already hit the limit.
    await chrome.storage.local.set({ blockedAt: null });
    console.log('[ReelGuard] Cooldown expired. Block lifted.');

    // Notify any open Instagram tabs to re-evaluate state.
    const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'UNBLOCKED' }).catch(() => {});
    }
  }
});

// ============================================================
// Reset helper: clears session data fully.
// ============================================================
async function resetSession() {
  await chrome.storage.local.set({
    sessionCount: 0,
    sessionStart: null,
    blockedAt: null
  });
  // Cancel any pending unblock alarm.
  await chrome.alarms.clear('unblock');
  console.log('[ReelGuard] Session reset.');
  return { ok: true };
}

// ============================================================
// background.js — Service Worker
// Handles storage coordination and cooldown alarm management.
// ============================================================

// Default settings used when the extension is first installed.
const DEFAULTS = {
  enabled: true,
  limitMode: 'reels',           // 'reels' or 'time'
  reelLimit: 20,                // max reels per session
  timeLimitMinutes: 15,         // max time per session (minutes)
  sessionCount: 0,              // reels watched this session
  sessionStart: null,           // timestamp (ms) when session began
  blockedAt: null,              // timestamp (ms) when blocked
  cooldownMinutes: 5,           // cooldown duration (minutes)
  overridePassword: ''          // password to bypass block (user must set)
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

  if (msg.type === 'CHECK_TIME_LIMIT') {
    // Content script requests a time-based block check.
    checkTimeLimit().then(sendResponse);
    return true;
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

  if (msg.type === 'BYPASS_WITH_PASSWORD') {
    // Content script submits password to bypass block.
    handlePasswordBypass(msg.password).then(sendResponse);
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

  const updates = { sessionCount, sessionStart };
  let action = 'COUNTED';

  // Check if we should block based on limit mode.
  const limitMode = state.limitMode || 'reels';
  const shouldBlock = evaluateBlock(state, sessionCount, sessionStart);

  if (shouldBlock) {
    // Trigger block.
    updates.blockedAt = Date.now();
    action = 'BLOCKED';
    // Schedule alarm to auto-lift block after cooldown.
    chrome.alarms.create('unblock', { delayInMinutes: state.cooldownMinutes || DEFAULTS.cooldownMinutes });
    const limit = limitMode === 'reels' ? state.reelLimit : state.timeLimitMinutes;
    const unit = limitMode === 'reels' ? 'Reels' : 'minutes';
    console.log(`[ReelGuard] Limit reached (${sessionCount} reels / ${Math.floor((Date.now() - sessionStart) / 60000)} min). Blocked.`);
  } else {
    // Check warning threshold: 75% of limit.
    const warnThreshold = getWarnThreshold(state, sessionStart);
    if (warnThreshold.shouldWarn) {
      action = 'WARN';
    }
  }

  await chrome.storage.local.set(updates);
  const newState = await chrome.storage.local.get(null);
  return { action, state: newState };
}

// ============================================================
// Helper: evaluate if user should be blocked.
// ============================================================
function evaluateBlock(state, sessionCount, sessionStart) {
  const limitMode = state.limitMode || 'reels';

  if (limitMode === 'time') {
    const elapsedMinutes = (Date.now() - sessionStart) / 60000;
    const timeLimit = state.timeLimitMinutes || DEFAULTS.timeLimitMinutes;
    return elapsedMinutes >= timeLimit;
  } else {
    const reelLimit = state.reelLimit || DEFAULTS.reelLimit;
    return sessionCount >= reelLimit;
  }
}

// ============================================================
// Helper: calculate warning threshold (75%) based on mode.
// ============================================================
function getWarnThreshold(state, sessionStart) {
  const limitMode = state.limitMode || 'reels';
  const sessionCount = state.sessionCount || 0;

  if (limitMode === 'time') {
    const elapsedMinutes = (Date.now() - sessionStart) / 60000;
    const timeLimit = state.timeLimitMinutes || DEFAULTS.timeLimitMinutes;
    const warnAt = timeLimit * 0.75;
    return {
      shouldWarn: elapsedMinutes >= warnAt && elapsedMinutes < timeLimit,
      current: elapsedMinutes,
      limit: timeLimit
    };
  } else {
    const reelLimit = state.reelLimit || DEFAULTS.reelLimit;
    const warnAt = Math.floor(reelLimit * 0.75);
    return {
      shouldWarn: sessionCount >= warnAt && sessionCount < reelLimit,
      current: sessionCount,
      limit: reelLimit
    };
  }
}

// ============================================================
// Time-based check: called periodically from content script.
// ============================================================
async function checkTimeLimit() {
  const state = await chrome.storage.local.get(null);

  if (!state.enabled || state.blockedAt || state.limitMode !== 'time') {
    return { action: 'NO_ACTION', state };
  }

  const sessionStart = state.sessionStart || Date.now();
  const elapsedMinutes = (Date.now() - sessionStart) / 60000;
  const timeLimit = state.timeLimitMinutes || DEFAULTS.timeLimitMinutes;

  let action = 'NONE';

  if (elapsedMinutes >= timeLimit) {
    // Trigger time-based block.
    await chrome.storage.local.set({ blockedAt: Date.now() });
    chrome.alarms.create('unblock', { delayInMinutes: state.cooldownMinutes || DEFAULTS.cooldownMinutes });
    action = 'BLOCKED';
    console.log('[ReelGuard] Time limit reached. Blocked.');
  }

  const newState = await chrome.storage.local.get(null);
  return { action, state: newState };
}

// ============================================================
// Password bypass handler.
// ============================================================
async function handlePasswordBypass(submittedPassword) {
  const state = await chrome.storage.local.get(null);
  const savedPassword = state.overridePassword || '';

  if (submittedPassword === savedPassword && savedPassword !== '') {
    // Correct password: clear block and reset session.
    await chrome.storage.local.set({
      blockedAt: null,
      sessionCount: 0,
      sessionStart: null
    });
    await chrome.alarms.clear('unblock');
    console.log('[ReelGuard] Block bypassed with correct password. Session reset.');
    return { success: true, state: await chrome.storage.local.get(null) };
  }

  // Wrong password: return error without clearing block.
  return { success: false, error: 'Incorrect password' };
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

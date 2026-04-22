// ============================================================
// content.js — Injected into instagram.com
// Responsibilities:
//   1. Detect when the user is on a Reels page
//   2. Detect when the current Reel changes (URL polling)
//   3. Communicate counts to background.js
//   4. Render and update the on-page HUD overlay
//   5. Show warning and blocking overlays at thresholds
//   6. Support time-based limits with periodic checks
// ============================================================

(function () {
  'use strict';

  // ---- State ------------------------------------------------
  let lastReelId = null;       // The last reel ID we detected from the URL
  let currentState = null;     // Cached state from chrome.storage
  let hudEl = null;            // The persistent HUD element
  let blockEl = null;          // The blocking overlay element
  let pollInterval = null;     // setInterval handle for URL polling
  let timeLimitCheckInterval = null; // setInterval for time limit checks
  let hudUpdateInterval = null; // setInterval for real-time HUD updates (time display)

  // ---- Constants --------------------------------------------
  // Regex to extract a reel ID from instagram.com/reels/XXXX/
  const REEL_URL_RE = /instagram\.com\/reels\/([^/?#]+)/;

  // ---- Initialization ---------------------------------------

  // Fetch initial state and set up the extension.
  async function init() {
    currentState = await sendMessage({ type: 'GET_STATE' });
    if (!currentState || !currentState.enabled) return;

    renderHUD();
    updateHUD();
    startPolling();
    startTimeLimitCheck();
    startHUDUpdateTimer();

    // Listen for background-pushed updates (e.g., UNBLOCKED after cooldown).
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'UNBLOCKED') {
        currentState.blockedAt = null;
        removeBlock();
        updateHUD();
      }
    });
  }

  // ---- URL Polling for Reel Detection -----------------------

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(checkForReelChange, 800);
  }

  async function checkForReelChange() {
    if (!currentState?.enabled) return;

    const reelId = extractReelId(window.location.href);

    // Not on a Reels page — hide HUD.
    if (!reelId) {
      if (hudEl) hudEl.style.display = 'none';
      lastReelId = null;
      return;
    }

    // On a Reels page — show HUD.
    if (hudEl) hudEl.style.display = 'flex';

    // If blocked, make sure block is shown.
    if (currentState.blockedAt) {
      showBlock();
      return;
    }

    // New reel detected.
    if (reelId !== lastReelId) {
      lastReelId = reelId;

      const response = await sendMessage({ type: 'INCREMENT_REEL' });
      if (!response) return;

      currentState = response.state || currentState;

      if (response.action === 'BLOCKED') {
        showBlock();
      } else if (response.action === 'WARN') {
        showWarningPulse();
      }

      updateHUD();
    }
  }

  function extractReelId(url) {
    const match = url.match(REEL_URL_RE);
    return match ? match[1] : null;
  }

  // ---- Time Limit Check (periodic) --------------------------
  // For time-based limits, periodically check if time has been exceeded.

  function startTimeLimitCheck() {
    if (timeLimitCheckInterval) clearInterval(timeLimitCheckInterval);
    // Check every 5 seconds while on Reels page.
    timeLimitCheckInterval = setInterval(async () => {
      if (!currentState?.enabled || currentState.limitMode !== 'time' || currentState.blockedAt) {
        return;
      }

      const response = await sendMessage({ type: 'CHECK_TIME_LIMIT' });
      if (!response) return;

      currentState = response.state || currentState;

      if (response.action === 'BLOCKED') {
        showBlock();
      }

      updateHUD();
    }, 5000);
  }

  // ---- HUD Real-time Update Timer ---------------------------
  // Updates HUD every second to show elapsed time in real-time.

  function startHUDUpdateTimer() {
    if (hudUpdateInterval) clearInterval(hudUpdateInterval);
    hudUpdateInterval = setInterval(() => {
      if (currentState?.enabled && hudEl && hudEl.style.display === 'flex') {
        updateHUD();
      }
    }, 1000);
  }

  // ---- HUD Overlay ------------------------------------------
  // Larger, clearer persistent element with dual progress bars and time display.

  function renderHUD() {
    if (hudEl) return;

    hudEl = document.createElement('div');
    hudEl.id = 'rg-hud';
    hudEl.style.display = 'none';
    hudEl.innerHTML = `
      <div id="rg-hud-inner">
        <div id="rg-hud-header">
          <div id="rg-hud-title">ReelGuard</div>
          <div id="rg-hud-status"></div>
        </div>

        <div id="rg-hud-metrics">
          <div id="rg-hud-reels">
            <span id="rg-hud-reels-num">0</span>
            <span id="rg-hud-reels-label">Reels</span>
          </div>
          <div id="rg-hud-divider"></div>
          <div id="rg-hud-time">
            <span id="rg-hud-time-num">0:00</span>
            <span id="rg-hud-time-label">Time</span>
          </div>
        </div>

        <div id="rg-hud-bars">
          <div id="rg-hud-bar-reels-wrap">
            <div id="rg-hud-bar-reels-bg">
              <div id="rg-hud-bar-reels-fill"></div>
            </div>
          </div>
          <div id="rg-hud-bar-time-wrap">
            <div id="rg-hud-bar-time-bg">
              <div id="rg-hud-bar-time-fill"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(hudEl);
  }

  function updateHUD() {
    if (!hudEl || !currentState) return;

    const limitMode = currentState.limitMode || 'reels';
    const reelCount = currentState.sessionCount || 0;
    const reelLimit = currentState.reelLimit || 20;
    const timeLimit = currentState.timeLimitMinutes || 15;

    // Elapsed time.
    let elapsedSeconds = 0;
    if (currentState.sessionStart) {
      elapsedSeconds = Math.floor((Date.now() - currentState.sessionStart) / 1000);
    }
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    const elapsedSecs = elapsedSeconds % 60;
    const timeStr = `${elapsedMinutes}:${elapsedSecs.toString().padStart(2, '0')}`;

    // Update metrics.
    document.getElementById('rg-hud-reels-num').textContent = reelCount;
    document.getElementById('rg-hud-time-num').textContent = timeStr;

    // Update progress bars.
    const reelPct = Math.min((reelCount / reelLimit) * 100, 100);
    const timePct = Math.min((elapsedMinutes / timeLimit) * 100, 100);

    const reelBarFill = document.getElementById('rg-hud-bar-reels-fill');
    const timeBarFill = document.getElementById('rg-hud-bar-time-fill');

    reelBarFill.style.width = reelPct + '%';
    timeBarFill.style.width = timePct + '%';

    // Color bars based on progress.
    const reelColor = getBarColor(reelPct);
    const timeColor = getBarColor(timePct);

    reelBarFill.style.background = reelColor;
    timeBarFill.style.background = timeColor;

    // Adjust opacity based on active mode.
    const reelBarWrap = document.getElementById('rg-hud-bar-reels-wrap');
    const timeBarWrap = document.getElementById('rg-hud-bar-time-wrap');

    if (limitMode === 'reels') {
      reelBarWrap.style.opacity = '1';
      timeBarWrap.style.opacity = '0.5';
    } else {
      reelBarWrap.style.opacity = '0.5';
      timeBarWrap.style.opacity = '1';
    }

    // Status message.
    const statusEl = document.getElementById('rg-hud-status');
    let statusText = '';
    let statusClass = '';

    if (currentState.blockedAt) {
      statusText = 'Blocked';
      statusClass = 'rg-status-blocked';
    } else if (limitMode === 'reels' && reelPct >= 75) {
      statusText = `${Math.round(reelPct)}% — slow down`;
      statusClass = 'rg-status-warn';
    } else if (limitMode === 'time' && timePct >= 75) {
      statusText = `${Math.round(timePct)}% — slow down`;
      statusClass = 'rg-status-warn';
    } else {
      statusText = 'Watching...';
      statusClass = '';
    }

    statusEl.textContent = statusText;
    statusEl.className = statusClass;

    // Apply warning class to HUD if needed.
    if ((limitMode === 'reels' && reelPct >= 75 && reelPct < 100) ||
        (limitMode === 'time' && timePct >= 75 && timePct < 100)) {
      hudEl.classList.add('rg-hud-warn');
    } else {
      hudEl.classList.remove('rg-hud-warn');
    }
  }

  function getBarColor(percentage) {
    if (percentage >= 100) {
      return '#9B6B6B'; // muted red for blocked
    } else if (percentage >= 75) {
      return '#B8956A'; // muted amber for warning
    } else {
      return '#7BA8A1'; // calming teal for normal
    }
  }

  // ---- Warning Pulse ----------------------------------------
  function showWarningPulse() {
    if (!hudEl) return;
    hudEl.classList.add('rg-warn-pulse');
    setTimeout(() => hudEl.classList.remove('rg-warn-pulse'), 1200);
  }

  // ---- Blocking Overlay with Password Input -----------------

  function showBlock() {
    if (blockEl && blockEl.isConnected) {
      updateCooldownTimer();
      return;
    }

    blockEl = document.createElement('div');
    blockEl.id = 'rg-block';

    const blockedAt = currentState.blockedAt || Date.now();
    const cooldownMs = (currentState.cooldownMinutes || 5) * 60 * 1000;
    const limitMode = currentState.limitMode || 'reels';
    let limitMessage = '';

    if (limitMode === 'reels') {
      const limit = currentState.reelLimit || 20;
      limitMessage = `You've watched <strong>${limit} Reels</strong> this session.`;
    } else {
      const limit = currentState.timeLimitMinutes || 15;
      limitMessage = `You've spent <strong>${limit} minutes</strong> on Reels this session.`;
    }

    blockEl.innerHTML = `
      <div id="rg-block-inner">
        <div id="rg-block-icon">⏸</div>
        <h2 id="rg-block-title">Time for a break.</h2>
        <p id="rg-block-body">
          ${limitMessage}<br>
          This is your intentional stopping point.
        </p>

        <div id="rg-cooldown-wrap">
          <div id="rg-cooldown-label">Available again in</div>
          <div id="rg-cooldown-timer">—</div>
        </div>

        <div id="rg-password-section">
          <p id="rg-password-prompt">
            Enter your password to continue (if you're sure):
          </p>
          <input
            type="password"
            id="rg-password-input"
            placeholder="Password"
            autocomplete="off"
          />
          <button id="rg-password-submit">Unlock</button>
          <div id="rg-password-error" style="display: none;"></div>
        </div>

        <div id="rg-block-hint">
          This is a moment to pause. Only continue if you've thought it through.
        </div>
      </div>
    `;

    document.body.appendChild(blockEl);

    // Start the cooldown countdown.
    updateCooldownTimer();
    const timerInterval = setInterval(() => {
      const remaining = getRemainingMs(blockedAt, cooldownMs);
      if (remaining <= 0) {
        clearInterval(timerInterval);
      } else {
        updateCooldownTimer();
      }
    }, 1000);

    // Password submit handler — use setTimeout to ensure DOM is ready.
    setTimeout(() => {
      const passwordInput = document.getElementById('rg-password-input');
      const passwordSubmit = document.getElementById('rg-password-submit');
      const passwordError = document.getElementById('rg-password-error');

      if (!passwordInput || !passwordSubmit) return;

      const handlePasswordSubmit = async () => {
        const password = passwordInput.value;
        if (!password) return;

        const response = await sendMessage({ type: 'BYPASS_WITH_PASSWORD', password });

        if (response && response.success) {
          currentState = response.state;
          removeBlock();
          updateHUD();
        } else {
          if (passwordError) {
            passwordError.textContent = 'Incorrect password. Try again.';
            passwordError.style.display = 'block';
          }
          passwordInput.value = '';
          passwordInput.focus();
        }
      };

      passwordSubmit.addEventListener('click', handlePasswordSubmit);
      passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handlePasswordSubmit();
        }
      });

      // Ensure input is focused and ready
      passwordInput.focus();
    }, 0);
  }

  function removeBlock() {
    if (blockEl && blockEl.isConnected) {
      blockEl.remove();
      blockEl = null;
    }
  }

  function updateCooldownTimer() {
    const timerEl = document.getElementById('rg-cooldown-timer');
    if (!timerEl || !currentState) return;

    const blockedAt = currentState.blockedAt;
    const cooldownMs = (currentState.cooldownMinutes || 5) * 60 * 1000;

    if (!blockedAt) {
      timerEl.textContent = '—';
      return;
    }

    const remaining = getRemainingMs(blockedAt, cooldownMs);
    if (remaining <= 0) {
      timerEl.textContent = 'Now';
    } else {
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
  }

  function getRemainingMs(blockedAt, cooldownMs) {
    return (blockedAt + cooldownMs) - Date.now();
  }

  // ---- Utility: sendMessage wrapper -------------------------
  function sendMessage(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }

  // ---- Listen for storage changes ---------------------------
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    currentState = await sendMessage({ type: 'GET_STATE' });
    updateHUD();
  });

  // ---- Start extension on page load -------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

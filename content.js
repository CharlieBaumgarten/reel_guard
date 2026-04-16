// ============================================================
// content.js — Injected into instagram.com
// Responsibilities:
//   1. Detect when the user is on a Reels page
//   2. Detect when the current Reel changes (URL polling)
//   3. Communicate counts to background.js
//   4. Render and update the on-page HUD overlay
//   5. Show warning and blocking overlays at thresholds
// ============================================================

(function () {
  'use strict';

  // ---- State ------------------------------------------------
  let lastReelId = null;       // The last reel ID we detected from the URL
  let currentState = null;     // Cached state from chrome.storage
  let hudEl = null;            // The persistent HUD element
  let blockEl = null;          // The blocking overlay element
  let pollInterval = null;     // setInterval handle for URL polling

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
  // Strategy: Poll the URL every 800ms.
  // Instagram Reels URLs look like: /reels/CxXXXXXXX/
  // When the reel ID segment changes, a new Reel has been watched.
  // This is simpler and more durable than DOM scraping.

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(checkForReelChange, 800);
  }

  async function checkForReelChange() {
    // Re-fetch state occasionally to pick up popup changes.
    // We do a lightweight check without full storage read most of the time.
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

      // Don't count the very first detection on page load as a new watch
      // if sessionCount is already > 0. Actually, we DO count it —
      // landing on a reel URL means you're watching a reel.
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

  // ---- HUD Overlay ------------------------------------------
  // A small persistent counter in the corner of the screen.
  // Non-intrusive until warning/block states.

  function renderHUD() {
    if (hudEl) return;

    hudEl = document.createElement('div');
    hudEl.id = 'rg-hud';
    hudEl.style.display = 'none'; // hidden until on a Reels page
    hudEl.innerHTML = `
      <div id="rg-hud-inner">
        <div id="rg-hud-label">ReelGuard</div>
        <div id="rg-hud-count">
          <span id="rg-count-num">0</span>
          <span id="rg-count-sep">/</span>
          <span id="rg-count-limit">20</span>
        </div>
        <div id="rg-hud-bar-bg">
          <div id="rg-hud-bar-fill"></div>
        </div>
        <div id="rg-hud-status"></div>
      </div>
    `;
    document.body.appendChild(hudEl);
  }

  function updateHUD() {
    if (!hudEl || !currentState) return;

    const count = currentState.sessionCount || 0;
    const limit = currentState.reelLimit || 20;
    const pct = Math.min((count / limit) * 100, 100);

    document.getElementById('rg-count-num').textContent = count;
    document.getElementById('rg-count-limit').textContent = limit;

    const bar = document.getElementById('rg-hud-bar-fill');
    bar.style.width = pct + '%';

    // Color the bar based on progress.
    if (pct >= 100) {
      bar.style.background = '#e63946';
    } else if (pct >= 75) {
      bar.style.background = '#f4a261';
    } else {
      bar.style.background = '#52b788';
    }

    // Status message.
    const statusEl = document.getElementById('rg-hud-status');
    if (currentState.blockedAt) {
      statusEl.textContent = 'Limit reached';
      statusEl.style.color = '#e63946';
    } else if (pct >= 75) {
      statusEl.textContent = 'Almost at limit';
      statusEl.style.color = '#f4a261';
    } else {
      statusEl.textContent = 'Watching';
      statusEl.style.color = '#aaa';
    }

    // Update elapsed time if session has started.
    if (currentState.sessionStart) {
      const elapsed = Math.floor((Date.now() - currentState.sessionStart) / 60000);
      document.getElementById('rg-hud-label').textContent = `ReelGuard · ${elapsed}m`;
    }
  }

  // ---- Warning Pulse ----------------------------------------
  // Briefly highlights the HUD to draw attention.
  function showWarningPulse() {
    if (!hudEl) return;
    hudEl.classList.add('rg-warn-pulse');
    setTimeout(() => hudEl.classList.remove('rg-warn-pulse'), 1200);
  }

  // ---- Blocking Overlay -------------------------------------
  // Covers the Reels content area and prevents casual dismissal.

  function showBlock() {
    // Don't create twice.
    if (blockEl && blockEl.isConnected) {
      updateCooldownTimer();
      return;
    }

    blockEl = document.createElement('div');
    blockEl.id = 'rg-block';

    const blockedAt = currentState.blockedAt || Date.now();
    const cooldownMs = (currentState.cooldownMinutes || 5) * 60 * 1000;
    const limit = currentState.reelLimit || 20;

    blockEl.innerHTML = `
      <div id="rg-block-inner">
        <div id="rg-block-icon">⏸</div>
        <h2 id="rg-block-title">Time for a break.</h2>
        <p id="rg-block-body">
          You've watched <strong>${limit} Reels</strong> this session.<br>
          This is your intentional stopping point.
        </p>
        <div id="rg-cooldown-wrap">
          <div id="rg-cooldown-label">Available again in</div>
          <div id="rg-cooldown-timer">—</div>
        </div>
        <button id="rg-block-dismiss" title="Dismiss anyway (session count resets)">
          Override &amp; Reset Session
        </button>
        <div id="rg-block-hint">Clicking override resets your count. It won't make the habit easier.</div>
      </div>
    `;

    document.body.appendChild(blockEl);

    // Start the cooldown countdown.
    updateCooldownTimer();
    const timerInterval = setInterval(() => {
      const remaining = getRemainingMs(blockedAt, cooldownMs);
      if (remaining <= 0) {
        clearInterval(timerInterval);
        // Background alarm will send UNBLOCKED message.
      } else {
        updateCooldownTimer();
      }
    }, 1000);

    // Override button — requires resetting session to bypass.
    document.getElementById('rg-block-dismiss').addEventListener('click', async () => {
      const confirmed = confirm(
        'Override your Reel limit?\n\nThis will reset your session count. Your limit is there because you set it. Are you sure?'
      );
      if (confirmed) {
        await sendMessage({ type: 'RESET_SESSION' });
        currentState = await sendMessage({ type: 'GET_STATE' });
        removeBlock();
        updateHUD();
      }
    });
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
          // Extension context may be invalidated on navigation; ignore gracefully.
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }

  // ---- Listen for storage changes from popup ----------------
  // If the user changes settings in the popup, re-sync state.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    currentState = await sendMessage({ type: 'GET_STATE' });
    updateHUD();
    // If extension was just disabled, stop polling.
    if (changes.enabled && !changes.enabled.newValue) {
      clearInterval(pollInterval);
      if (hudEl) hudEl.style.display = 'none';
      removeBlock();
    } else if (changes.enabled && changes.enabled.newValue) {
      startPolling();
    }
  });

  // ---- Boot -------------------------------------------------
  init();

})();

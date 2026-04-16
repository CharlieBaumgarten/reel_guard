// ============================================================
// popup.js — Controls the extension popup UI
// Reads from chrome.storage.local and sends messages to
// background.js to update settings and reset sessions.
// ============================================================

(async function () {
  'use strict';

  // ---- Fetch current state from storage -------------------
  const state = await chrome.storage.local.get(null);

  // ---- DOM refs -------------------------------------------
  const toggleEl       = document.getElementById('toggle-enabled');
  const statCountEl    = document.getElementById('stat-count');
  const statLimitEl    = document.getElementById('stat-limit');
  const statTimeEl     = document.getElementById('stat-time');
  const barFillEl      = document.getElementById('popup-bar-fill');
  const statusEl       = document.getElementById('popup-status');
  const inputLimitEl   = document.getElementById('input-limit');
  const inputCooldownEl = document.getElementById('input-cooldown');
  const btnSaveLimitEl = document.getElementById('btn-save-limit');
  const btnSaveCooldownEl = document.getElementById('btn-save-cooldown');
  const btnResetEl     = document.getElementById('btn-reset');

  // ---- Populate UI from state -----------------------------
  function render(s) {
    const count  = s.sessionCount || 0;
    const limit  = s.reelLimit || 20;
    const pct    = Math.min((count / limit) * 100, 100);

    toggleEl.checked = !!s.enabled;
    statCountEl.textContent = count;
    statLimitEl.textContent = limit;

    // Elapsed session time.
    if (s.sessionStart) {
      const mins = Math.floor((Date.now() - s.sessionStart) / 60000);
      statTimeEl.textContent = mins < 1 ? '<1m' : `${mins}m`;
    } else {
      statTimeEl.textContent = '—';
    }

    // Progress bar.
    barFillEl.style.width = pct + '%';
    if (pct >= 100) {
      barFillEl.style.background = '#e63946';
    } else if (pct >= 75) {
      barFillEl.style.background = '#f4a261';
    } else {
      barFillEl.style.background = '#52b788';
    }

    // Status message.
    if (s.blockedAt) {
      const cooldownMs = (s.cooldownMinutes || 5) * 60 * 1000;
      const remaining = Math.max(0, (s.blockedAt + cooldownMs) - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      statusEl.textContent = remaining > 0
        ? `Locked — unlocks in ${mins}:${secs.toString().padStart(2, '0')}`
        : 'Block lifted — good timing!';
      statusEl.style.color = '#e63946';
    } else if (pct >= 75) {
      statusEl.textContent = `Almost at your limit (${count}/${limit})`;
      statusEl.style.color = '#f4a261';
    } else if (count === 0) {
      statusEl.textContent = 'No Reels watched yet this session';
      statusEl.style.color = 'rgba(255,255,255,0.38)';
    } else {
      statusEl.textContent = `${count} of ${limit} Reels watched`;
      statusEl.style.color = 'rgba(255,255,255,0.38)';
    }

    // Settings inputs.
    inputLimitEl.value    = s.reelLimit || 20;
    inputCooldownEl.value = s.cooldownMinutes || 5;
  }

  render(state);

  // If blocked, refresh the countdown every second.
  if (state.blockedAt) {
    setInterval(async () => {
      const fresh = await chrome.storage.local.get(null);
      render(fresh);
    }, 1000);
  }

  // ---- Enable/Disable toggle ------------------------------
  toggleEl.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: toggleEl.checked });
  });

  // ---- Save limit -----------------------------------------
  btnSaveLimitEl.addEventListener('click', async () => {
    const newLimit = parseInt(inputLimitEl.value, 10);
    if (!newLimit || newLimit < 1) return;
    await chrome.storage.local.set({ reelLimit: newLimit });
    btnSaveLimitEl.textContent = '✓';
    setTimeout(() => { btnSaveLimitEl.textContent = 'Save'; }, 1200);
    const fresh = await chrome.storage.local.get(null);
    render(fresh);
  });

  // ---- Save cooldown --------------------------------------
  btnSaveCooldownEl.addEventListener('click', async () => {
    const newCooldown = parseInt(inputCooldownEl.value, 10);
    if (!newCooldown || newCooldown < 1) return;
    await chrome.storage.local.set({ cooldownMinutes: newCooldown });
    btnSaveCooldownEl.textContent = '✓';
    setTimeout(() => { btnSaveCooldownEl.textContent = 'Save'; }, 1200);
  });

  // ---- Reset session --------------------------------------
  btnResetEl.addEventListener('click', async () => {
    const confirmed = confirm('Reset your Reel session count?\nThis also removes any current block.');
    if (!confirmed) return;

    // Send reset message to background so alarms are cleared too.
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RESET_SESSION' }, resolve);
    });

    const fresh = await chrome.storage.local.get(null);
    render(fresh);
    btnResetEl.textContent = 'Reset ✓';
    setTimeout(() => { btnResetEl.textContent = 'Reset Session'; }, 1500);
  });

})();

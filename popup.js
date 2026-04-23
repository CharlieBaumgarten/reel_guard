// ============================================================
// popup.js — Controls the extension popup UI
// Reads from chrome.storage.local and sends messages to
// background.js to update settings and manage sessions.
// ============================================================

(async function () {
  'use strict';

  // ---- Fetch current state from storage -------------------
  let state = await chrome.storage.local.get(null);

  // ---- DOM refs -------------------------------------------
  const toggleEl = document.getElementById('toggle-enabled');
  const analyticsBtn = document.getElementById('btn-analytics');
  const backBtn = document.getElementById('back-btn');
  const mainView = document.getElementById('main-view');
  const analyticsView = document.getElementById('analytics-view');

  // Session stats
  const statCountEl = document.getElementById('stat-count');
  const statTimeEl = document.getElementById('stat-time');

  // Progress bars
  const reelBarFillEl = document.getElementById('popup-bar-reels-fill');
  const timeBarFillEl = document.getElementById('popup-bar-time-fill');
  const reelBarStatusEl = document.getElementById('popup-bar-reels-status');
  const timeBarStatusEl = document.getElementById('popup-bar-time-status');

  // Mode buttons
  const modeReelsBtn = document.getElementById('mode-reels-btn');
  const modeTimeBtn = document.getElementById('mode-time-btn');

  // Setting rows
  const settingReelLimitRow = document.getElementById('setting-reel-limit');
  const settingTimeLimitRow = document.getElementById('setting-time-limit');

  // Setting inputs
  const inputReelLimitEl = document.getElementById('input-reel-limit');
  const inputTimeLimitEl = document.getElementById('input-time-limit');
  const inputCooldownEl = document.getElementById('input-cooldown');
  const inputPasswordEl = document.getElementById('input-password');

  // Buttons
  const btnSaveReelLimitEl = document.getElementById('btn-save-reel-limit');
  const btnSaveTimeLimitEl = document.getElementById('btn-save-time-limit');
  const btnSaveCooldownEl = document.getElementById('btn-save-cooldown');
  const btnSavePasswordEl = document.getElementById('btn-save-password');
  const btnResetEl = document.getElementById('btn-reset');

  // ---- Utility: Format time as mm:ss -----
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // ---- Render UI from state --------
  function render(s) {
    const limitMode = s.limitMode || 'reels';
    const reelCount = s.sessionCount || 0;
    const reelLimit = s.reelLimit || 20;
    const timeLimit = s.timeLimitMinutes || 15;
    const enabled = s.enabled !== false;

    // Update toggle
    toggleEl.checked = enabled;

    // Calculate elapsed time
    let elapsedSeconds = 0;
    if (s.sessionStart) {
      elapsedSeconds = Math.floor((Date.now() - s.sessionStart) / 1000);
    }
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);

    // Update stats
    statCountEl.textContent = reelCount;
    statTimeEl.textContent = formatTime(elapsedSeconds);

    // Update progress bars
    const reelPct = Math.min((reelCount / reelLimit) * 100, 100);
    const timePct = Math.min((elapsedMinutes / timeLimit) * 100, 100);

    reelBarFillEl.style.width = reelPct + '%';
    timeBarFillEl.style.width = timePct + '%';

    // Color bars
    reelBarFillEl.style.background = getBarColor(reelPct);
    timeBarFillEl.style.background = getBarColor(timePct);

    // Adjust opacity based on mode
    document.getElementById('popup-bar-reels-wrap').style.opacity = limitMode === 'reels' ? '1' : '0.5';
    document.getElementById('popup-bar-time-wrap').style.opacity = limitMode === 'time' ? '1' : '0.5';

    // Status text
    reelBarStatusEl.textContent = `${reelCount} / ${reelLimit}`;
    timeBarStatusEl.textContent = `${elapsedMinutes} / ${timeLimit} min`;

    // Update mode buttons
    const isReelMode = limitMode === 'reels';
    modeReelsBtn.classList.toggle('active', isReelMode);
    modeTimeBtn.classList.toggle('active', !isReelMode);

    // Show/hide setting rows based on mode
    settingReelLimitRow.style.display = isReelMode ? 'flex' : 'none';
    settingTimeLimitRow.style.display = !isReelMode ? 'flex' : 'none';

    // Update inputs
    inputReelLimitEl.value = reelLimit;
    inputTimeLimitEl.value = timeLimit;
    inputCooldownEl.value = s.cooldownMinutes || 5;
    inputPasswordEl.value = s.overridePassword || '';
  }

  function getBarColor(percentage) {
    if (percentage >= 100) {
      return '#9B6B6B'; // muted red
    } else if (percentage >= 75) {
      return '#B8956A'; // muted amber
    } else {
      return '#7BA8A1'; // calming teal
    }
  }

  render(state);

  // ---- Enable/Disable toggle ------
  toggleEl.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: toggleEl.checked });
    
    // Reset session when toggling
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RESET_SESSION' }, resolve);
    });
    
    const fresh = await chrome.storage.local.get(null);
    state = fresh;
    render(fresh);
  });

  // ---- Analytics navigation -------
  analyticsBtn.addEventListener('click', () => {
    mainView.style.display = 'none';
    analyticsView.style.display = 'block';
  });

  backBtn.addEventListener('click', () => {
    analyticsView.style.display = 'none';
    mainView.style.display = 'block';
  });

  // ---- Mode switching --------------
  modeReelsBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ limitMode: 'reels' });
    const fresh = await chrome.storage.local.get(null);
    state = fresh;
    render(fresh);
  });

  modeTimeBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ limitMode: 'time' });
    const fresh = await chrome.storage.local.get(null);
    state = fresh;
    render(fresh);
  });

  // ---- Save reel limit -----
  btnSaveReelLimitEl.addEventListener('click', async () => {
    const newLimit = parseInt(inputReelLimitEl.value, 10);
    if (!newLimit || newLimit < 1) return;
    await chrome.storage.local.set({ reelLimit: newLimit });
    btnSaveReelLimitEl.textContent = '✓';
    setTimeout(() => {
      btnSaveReelLimitEl.textContent = 'Save';
    }, 1200);
    const fresh = await chrome.storage.local.get(null);
    state = fresh;
    render(fresh);
  });

  // ---- Save time limit -----
  btnSaveTimeLimitEl.addEventListener('click', async () => {
    const newLimit = parseInt(inputTimeLimitEl.value, 10);
    if (!newLimit || newLimit < 1) return;
    await chrome.storage.local.set({ timeLimitMinutes: newLimit });
    btnSaveTimeLimitEl.textContent = '✓';
    setTimeout(() => {
      btnSaveTimeLimitEl.textContent = 'Save';
    }, 1200);
    const fresh = await chrome.storage.local.get(null);
    state = fresh;
    render(fresh);
  });

  // ---- Save cooldown ------
  btnSaveCooldownEl.addEventListener('click', async () => {
    const newCooldown = parseInt(inputCooldownEl.value, 10);
    if (!newCooldown || newCooldown < 1) return;
    await chrome.storage.local.set({ cooldownMinutes: newCooldown });
    btnSaveCooldownEl.textContent = '✓';
    setTimeout(() => {
      btnSaveCooldownEl.textContent = 'Save';
    }, 1200);
  });

  // ---- Save password ------
  btnSavePasswordEl.addEventListener('click', async () => {
    const password = inputPasswordEl.value;
    if (password === '') {
      alert('Please enter a password.');
      return;
    }
    await chrome.storage.local.set({ overridePassword: password });
    btnSavePasswordEl.textContent = '✓ Saved';
    setTimeout(() => {
      btnSavePasswordEl.textContent = 'Save';
    }, 1200);
  });

  // ---- Reset session ------
  btnResetEl.addEventListener('click', async () => {
    const confirmed = confirm('Reset your Reel session count?\nThis also removes any current block.');
    if (!confirmed) return;

    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RESET_SESSION' }, resolve);
    });

    const fresh = await chrome.storage.local.get(null);
    state = fresh;
    render(fresh);
    btnResetEl.textContent = 'Reset ✓';
    setTimeout(() => {
      btnResetEl.textContent = 'Reset Session';
    }, 1500);
  });

  // ---- Auto-refresh when blocked ----
  // If the user is blocked, refresh the UI every second to show the countdown.
  if (state.blockedAt) {
    setInterval(async () => {
      const fresh = await chrome.storage.local.get(null);
      state = fresh;
      render(fresh);
    }, 1000);
  }

})();

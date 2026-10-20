// Extracted from public/dashboard.js — self-initializes on the shared
// rcs:user-loaded event dispatched by topbar.js. Skips silently if the
// modal partial isn't included on the current page.

(() => {
const secToMin = (s) => Math.max(0, Math.round((Number(s) || 0) / 60));
const minToSec = (m) => Math.max(0, Math.round(Number(m) || 0) * 60);

async function initPreferencesPanel(user) {
  const basePath = location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');
  const breakInput = document.getElementById('pref-break-input');
  const lunchInput = document.getElementById('pref-lunch-input');
  const saveBtn = document.getElementById('preferences-save-btn');
  const resetBtn = document.getElementById('preferences-reset-btn');
  const feedback = document.getElementById('preferences-feedback');

  // Queue alerts are supervisor-only; the block stays hidden for everyone else.
  const isSupervisor = !!(user && (user.supervisor || user.superAdmin));
  const qaBlock = document.getElementById('preferences-queue-alerts');
  const qaEnabled = document.getElementById('pref-queue-alerts-enabled');
  const qaDepth = document.getElementById('pref-queue-depth');
  const qaWait = document.getElementById('pref-queue-wait');
  const qaSound = document.getElementById('pref-queue-sound');
  const qaSticky = document.getElementById('pref-queue-sticky');
  const qaStatus = document.getElementById('pref-queue-alerts-status');
  const qaTest = document.getElementById('pref-queue-alerts-test');
  const qaSupported = 'Notification' in window;
  if (isSupervisor && qaBlock) qaBlock.style.display = '';

  let initial = { breakMin: 2, lunchMin: 10, qaEnabled: false, qaDepth: 5, qaWaitMin: 5, qaSound: true, qaSticky: true };
  // Set when a permission prompt is dismissed rather than answered — the
  // permission stays 'default', which is otherwise indistinguishable from
  // "never asked" and would silently read as "alerts are off".
  let permissionDismissed = false;

  // Reflects two independent things: the saved preference (the switch) and the
  // browser's permission, which is a per-device fact read live. Thresholds are
  // disabled while the switch is off so alerts can't be "configured" into a
  // state where nothing will ever fire.
  function refreshQueueAlertUi() {
    if (!isSupervisor || !qaBlock) return;
    const on = qaEnabled.checked;
    qaDepth.disabled = qaWait.disabled = qaSound.disabled = qaSticky.disabled = !on;
    qaBlock.classList.toggle('preferences-block-off', !on);

    let msg;
    let tone;
    if (!qaSupported) {
      msg = 'This browser does not support desktop notifications.';
      tone = 'bad';
    } else if (Notification.permission === 'denied') {
      msg = 'Blocked by your browser. Click the padlock in the address bar → Notifications → Allow, then reload this page.';
      tone = 'bad';
    } else if (permissionDismissed && Notification.permission !== 'granted') {
      msg = 'Permission prompt was dismissed, so alerts stayed off. Click "Test alert" to get the prompt again.';
      tone = 'bad';
    } else if (!on) {
      msg = 'Alerts are off. Turn on the switch above to receive them.';
      tone = 'warn';
    } else if (Notification.permission === 'granted') {
      msg = 'Alerts are on for this browser. Use "Test alert" to confirm.';
      tone = 'ok';
    } else {
      msg = 'Your browser will ask for permission — choose Allow.';
      tone = 'warn';
    }
    // The switch only takes effect once saved; say so rather than letting a
    // ticked-but-unsaved box read as "on".
    if (on !== initial.qaEnabled) {
      msg += ' Not saved yet — click Save.';
      tone = 'warn';
    }
    qaStatus.textContent = msg;
    qaStatus.className = `preferences-hint preferences-status-${tone}`;
  }

  function recomputeDirty() {
    let dirty =
      Number(breakInput.value) !== initial.breakMin ||
      Number(lunchInput.value) !== initial.lunchMin;
    if (isSupervisor && qaBlock) {
      dirty = dirty ||
        qaEnabled.checked !== initial.qaEnabled ||
        Number(qaDepth.value) !== initial.qaDepth ||
        Number(qaWait.value) !== initial.qaWaitMin ||
        qaSound.checked !== initial.qaSound ||
        qaSticky.checked !== initial.qaSticky;
    }
    saveBtn.disabled = !dirty;
    resetBtn.disabled = !dirty;
    return dirty;
  }

  function applyQueueAlertValues() {
    if (!isSupervisor || !qaBlock) return;
    qaEnabled.checked = initial.qaEnabled;
    qaDepth.value = initial.qaDepth;
    qaWait.value = initial.qaWaitMin;
    qaSound.checked = initial.qaSound;
    qaSticky.checked = initial.qaSticky;
  }

  async function load() {
    feedback.textContent = '';
    breakInput.disabled = lunchInput.disabled = true;
    try {
      const requests = [fetch(`${basePath}/api/me/reminders`)];
      if (isSupervisor) requests.push(fetch(`${basePath}/api/me/queue-alerts`));
      const [remRes, qaRes] = await Promise.all(requests);
      if (!remRes.ok) throw new Error('fetch failed');
      const data = await remRes.json();
      initial = {
        ...initial,
        breakMin: secToMin(data.preferredBreakTimer),
        lunchMin: secToMin(data.preferredLunchTimer),
      };
      if (qaRes && qaRes.ok) {
        const qa = await qaRes.json();
        initial = {
          ...initial,
          qaEnabled: !!qa.enabled,
          qaDepth: Number.isFinite(qa.queueDepth) ? qa.queueDepth : 5,
          qaWaitMin: secToMin(qa.waitSeconds) || 5,
          qaSound: qa.sound !== false,
          qaSticky: qa.sticky !== false,
        };
      }
      breakInput.value = initial.breakMin;
      lunchInput.value = initial.lunchMin;
      applyQueueAlertValues();
      refreshQueueAlertUi();
    } catch {
      feedback.textContent = 'Failed to load preferences.';
      feedback.className = 'settings-feedback text-danger';
    } finally {
      breakInput.disabled = lunchInput.disabled = false;
      recomputeDirty();
    }
  }

  breakInput.addEventListener('input', () => { feedback.textContent = ''; recomputeDirty(); });
  lunchInput.addEventListener('input', () => { feedback.textContent = ''; recomputeDirty(); });

  if (isSupervisor && qaBlock) {
    if (!qaSupported) {
      qaEnabled.checked = false;
      qaEnabled.disabled = true;
    }
    // Requesting permission needs a user gesture — this click is one. The
    // preference itself still saves through the normal Save button.
    qaEnabled.addEventListener('change', async () => {
      feedback.textContent = '';
      if (qaEnabled.checked && qaSupported && Notification.permission !== 'granted') {
        try {
          const result = await Notification.requestPermission();
          permissionDismissed = result === 'default';
          if (result !== 'granted') qaEnabled.checked = false;
        } catch {
          qaEnabled.checked = false;
        }
      } else if (qaEnabled.checked) {
        permissionDismissed = false;
      }
      refreshQueueAlertUi();
      recomputeDirty();
    });
    qaDepth.addEventListener('input', () => { feedback.textContent = ''; recomputeDirty(); });
    qaWait.addEventListener('input', () => { feedback.textContent = ''; recomputeDirty(); });
    qaSound.addEventListener('change', () => { feedback.textContent = ''; recomputeDirty(); });
    qaSticky.addEventListener('change', () => { feedback.textContent = ''; recomputeDirty(); });
    // Fires a real notification + chime end-to-end, so "did this actually work?"
    // is answerable without waiting for the queue to back up. Also the audio
    // unlock, and a second chance at the permission prompt — a real click is
    // the gesture browsers require for both.
    if (qaTest) {
      qaTest.addEventListener('click', async () => {
        feedback.textContent = '';
        if (!qaSupported) { refreshQueueAlertUi(); return; }
        if (Notification.permission === 'default') {
          try {
            const result = await Notification.requestPermission();
            permissionDismissed = result === 'default';
          } catch { /* treated as not granted */ }
          refreshQueueAlertUi();
        }
        if (Notification.permission !== 'granted') {
          refreshQueueAlertUi();
          return;
        }
        // Preview the live control values, not the saved ones, so Test shows
        // what Save is about to commit.
        window.rcs?.queueAlerts?.testAlert({ sound: qaSound.checked, sticky: qaSticky.checked });
      });
    }
  }

  resetBtn.onclick = () => {
    breakInput.value = initial.breakMin;
    lunchInput.value = initial.lunchMin;
    applyQueueAlertValues();
    feedback.textContent = '';
    recomputeDirty();
  };

  saveBtn.onclick = async () => {
    if (!recomputeDirty()) return;
    saveBtn.disabled = resetBtn.disabled = true;
    feedback.textContent = 'Saving...';
    feedback.className = 'settings-feedback';
    try {
      const queueAlertPayload = isSupervisor && qaBlock ? {
        enabled: qaEnabled.checked,
        queueDepth: Number(qaDepth.value),
        waitSeconds: minToSec(qaWait.value),
        sound: qaSound.checked,
        sticky: qaSticky.checked,
      } : null;

      const requests = [
        fetch(`${basePath}/api/me/reminders`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preferredBreakTimer: minToSec(breakInput.value),
            preferredLunchTimer: minToSec(lunchInput.value),
          }),
        }),
      ];
      if (queueAlertPayload) {
        requests.push(fetch(`${basePath}/api/me/queue-alerts`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queueAlertPayload),
        }));
      }
      const [remRes, qaRes] = await Promise.all(requests);
      if (!remRes.ok || (qaRes && !qaRes.ok)) throw new Error('save failed');

      initial = {
        ...initial,
        breakMin: Number(breakInput.value),
        lunchMin: Number(lunchInput.value),
      };
      if (queueAlertPayload) {
        initial = {
          ...initial,
          qaEnabled: queueAlertPayload.enabled,
          qaDepth: queueAlertPayload.queueDepth,
          qaWaitMin: Number(qaWait.value),
          qaSound: queueAlertPayload.sound,
          qaSticky: queueAlertPayload.sticky,
        };
        // Let a running dashboard pick up new thresholds without a reload.
        window.dispatchEvent(new CustomEvent('rcs:queue-alert-prefs-changed', { detail: queueAlertPayload }));
      }
      feedback.textContent = 'Saved.';
      feedback.className = 'settings-feedback text-success';
    } catch {
      feedback.textContent = 'Failed to save.';
      feedback.className = 'settings-feedback text-danger';
    }
    recomputeDirty();
  };

  document.getElementById('preferences-modal').addEventListener('show.bs.modal', load);
}

(() => {
  window.addEventListener('rcs:user-loaded', (e) => {
    if (!document.getElementById('preferences-modal')) return;
    const user = e.detail || (window.rcs && window.rcs.currentUser) || null;
    if (!user) return;
    initPreferencesPanel(user);
  });
})();
})();

// Per-supervisor queue alerts: desktop notification + chime when the queue gets
// deep or a caller waits too long. Self-initializes on the shared rcs:user-loaded
// event dispatched by topbar.js and bails silently for non-supervisors.
//
// Evaluation is client-side on purpose: dashboard.js already re-ticks every
// second off the WebSocket queue payload, and thresholds are per-supervisor, so
// there is nothing for the server to schedule.
//
// Loaded on every page (not just the dashboard) so the Preferences "Test" button
// can reach playChime() from anywhere. check() only runs where there's a queue.

(() => {
const DEFAULTS = { enabled: false, queueDepth: 5, waitSeconds: 300, sound: true, sticky: true };

let prefs = { ...DEFAULTS };
// Depth alert is edge-triggered: fire on the crossing, re-arm only after the
// queue drops back to/below the threshold. Same shape as the activeTimers.has()
// guard in src/helpers/callback_timers.js — don't re-fire while the condition holds.
let depthAlerted = false;
// Long-wait alert fires once per call record, keyed on its id.
const waitAlerted = new Set();

let audioCtx = null;

function basePath() {
  return location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');
}

function ensureCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

// Browsers block audio until the page has seen a user gesture, so grab the
// first one to get the context running ahead of any alert.
function unlockAudio() {
  try {
    const ctx = ensureCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  } catch { /* audio is a nice-to-have; never let it break the page */ }
}

// Short two-tone chime. No audio asset to ship or serve; swap this body for
// new Audio('alert.mp3').play() if a specific sound is ever wanted.
async function playChime() {
  try {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();
    // Still blocked (no user gesture yet) — the notification already showed,
    // so just go without the sound rather than throwing.
    if (ctx.state !== 'running') return;
    const start = ctx.currentTime;
    for (const [freq, offset] of [[880, 0], [1174.66, 0.15]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.linearRampToValueAtTime(0.25, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.25);
    }
  } catch { /* ignore */ }
}

// Shows the notification only — the chime is played once per check() pass so a
// burst of alerts can't stack overlapping copies of it.
function notify(title, body, tag, opts) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const sticky = opts && typeof opts.sticky === 'boolean' ? opts.sticky : prefs.sticky;
  try {
    // tag lets the OS collapse repeats of the same alert rather than stacking them.
    // requireInteraction keeps it on screen until dismissed — honored by
    // Chrome/Edge on desktop; Firefox and Safari ignore it and auto-dismiss.
    const n = new Notification(title, { body, tag, requireInteraction: sticky });
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch (e) {
    console.error('Queue alert notification failed:', e);
    return false;
  }
}

function formatWait(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

// Fires regardless of document.hidden: desktop notification + sound is the only
// delivery channel, so suppressing while visible would leave a dashboard on a
// wall monitor with no alert at all.
function check(queue) {
  if (!prefs.enabled) {
    depthAlerted = false;
    waitAlerted.clear();
    return;
  }
  const list = Array.isArray(queue) ? queue : [];
  let fired = 0;

  // Threshold is inclusive: set it to 1 and a single waiting caller alerts.
  if (list.length >= prefs.queueDepth) {
    if (!depthAlerted) {
      depthAlerted = true;
      if (notify(
        'Queue backing up',
        `${list.length} ${list.length === 1 ? 'caller' : 'callers'} waiting (alert set at ${prefs.queueDepth} or more).`,
        'rcs-queue-depth',
      )) fired++;
    }
  } else {
    depthAlerted = false;
  }

  const present = new Set();
  const crossed = [];
  for (const call of list) {
    if (!call || !call.id) continue;
    present.add(call.id);
    if (waitAlerted.has(call.id)) continue;
    const waited = Math.floor((Date.now() - new Date(call.startTime)) / 1000);
    // Inclusive too, to match the depth threshold: at exactly the limit, alert.
    if (!Number.isFinite(waited) || waited < prefs.waitSeconds) continue;
    waitAlerted.add(call.id);
    crossed.push({ call, waited });
  }

  // Several callers can cross in the same pass (typically right after enabling
  // alerts with a queue already backed up). Collapse that into one notification
  // rather than firing a stack of them.
  if (crossed.length > 2) {
    const longest = crossed.reduce((a, b) => (b.waited > a.waited ? b : a));
    if (notify(
      'Callers waiting too long',
      `${crossed.length} callers have waited ${formatWait(prefs.waitSeconds)} or more. Longest: ${formatWait(longest.waited)}.`,
      'rcs-wait-multi',
    )) fired++;
  } else {
    for (const { call, waited } of crossed) {
      const who = call.callerName || call.callerNumber || 'A caller';
      if (notify(
        'Caller waiting too long',
        `${who} has been waiting ${formatWait(waited)}.`,
        `rcs-wait-${call.id}`,
      )) fired++;
    }
  }

  // Drop ids that have left the queue so the set can't grow unbounded.
  for (const id of waitAlerted) if (!present.has(id)) waitAlerted.delete(id);

  if (fired && prefs.sound) playChime();
}

async function loadPrefs() {
  try {
    const res = await fetch(`${basePath()}/api/me/queue-alerts`);
    if (!res.ok) return;
    const data = await res.json();
    prefs = {
      enabled: !!data.enabled,
      queueDepth: Number.isFinite(data.queueDepth) ? data.queueDepth : DEFAULTS.queueDepth,
      waitSeconds: Number.isFinite(data.waitSeconds) ? data.waitSeconds : DEFAULTS.waitSeconds,
      sound: data.sound !== false,
      sticky: data.sticky !== false,
    };
  } catch {
    // Keep the defaults (alerts off) rather than guessing.
  }
}

// Deliberately ignores prefs.enabled: this is how a supervisor confirms the
// whole path works (permission -> notification -> sound) before trusting it.
function testAlert(opts) {
  const sticky = opts && typeof opts.sticky === 'boolean' ? opts.sticky : prefs.sticky;
  const shown = notify(
    'Queue alerts are working',
    sticky
      ? 'This is a test. Real alerts look like this and stay until you dismiss them.'
      : 'This is a test. Real alerts look like this.',
    'rcs-queue-test',
    { sticky },
  );
  const sound = opts && typeof opts.sound === 'boolean' ? opts.sound : prefs.sound;
  if (sound) playChime();
  return shown;
}

window.rcs = window.rcs || {};
window.rcs.queueAlerts = { check, playChime, unlockAudio, testAlert };

window.addEventListener('rcs:user-loaded', async (e) => {
  const user = e.detail || (window.rcs && window.rcs.currentUser) || null;
  if (!user || !(user.supervisor || user.superAdmin)) return;
  await loadPrefs();
  window.addEventListener('click', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
  // Preferences panel fires this after a successful save so thresholds take
  // effect without a page reload.
  window.addEventListener('rcs:queue-alert-prefs-changed', (evt) => {
    if (evt.detail) prefs = { ...prefs, ...evt.detail };
    else loadPrefs();
  });
});
})();

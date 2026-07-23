const router = require('express').Router();
const dashboardController = require('../controllers/dashboard');
const reportsController = require('../controllers/reports');
const atp = require('../ATP');
const ava = require('../AVA');
const websocket = require('../helpers/websocket');
const { createLogger } = require('../helpers/logger');

const announcementsLogger = createLogger('announcements');
const trackedIssuesLogger = createLogger('trackedIssues');
const {
  getVisibilityConfig,
  getPermissions,
  getViewScopes,
  canAccess,
  FEATURES,
  FEATURE_TIERS,
} = require('../helpers/dashboardAccess');
const { USER_FLAGS, USER_FLAG_KEY_SET } = require('../helpers/userFlags');
const { getBufferSeconds, setBufferSeconds, DEFAULT_BUFFER_SECONDS } = require('../helpers/breakLateBuffer');

const REMINDER_KEYS = ['preferredBreakTimer', 'preferredLunchTimer'];
function parseReminderUpdates(payload) {
  // Returns { updates } on success, { error } on failure.
  // Values are integer SECONDS, non-negative.
  if (!payload || typeof payload !== 'object') return { error: 'Invalid payload' };
  const updates = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!REMINDER_KEYS.includes(key)) return { error: `Unknown reminder field: ${key}` };
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
      return { error: `${key} must be a non-negative integer (seconds)` };
    }
    updates[key] = n;
  }
  if (Object.keys(updates).length === 0) return { error: 'No reminder updates provided' };
  return { updates };
}

const requireSupervisor = (req, res, next) => {
  if (!req.session?.user?.superAdmin && !req.session?.user?.supervisor) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const requireReportsAccess = async (req, res, next) => {
  try {
    const config = await getVisibilityConfig();
    if (!canAccess(config.reports, req.session?.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  } catch {
    return res.status(500).json({ error: 'Failed to verify access' });
  }
};

router.get('/api', dashboardController.getData);
router.get('/api/stats', dashboardController.getStats);
router.get('/api/reports', requireReportsAccess, reportsController.getReports);

router.get('/api/me', async (req, res) => {
  try {
    const config = await getVisibilityConfig();
    const permissions = getPermissions(req.session.user, config);
    const viewScopes = getViewScopes(req.session.user, config);
    res.json({ ...req.session.user, permissions, viewScopes });
  } catch {
    res.json({ ...req.session.user, permissions: {}, viewScopes: {} });
  }
});

router.delete('/api/queue/:id', requireSupervisor, dashboardController.removeQueueCall);
router.delete('/api/call/:id', requireSupervisor, dashboardController.clearAgentCall);

// User feature-flag admin (supervisors + superAdmins)
router.get('/api/users/flags', requireSupervisor, async (req, res) => {
  try {
    const users = await atp.users.fetchAll({});
    // super_admins can manage flags on supervisors too; regular supervisors
    // only see non-supervisor agents. Extension prefix filter (82* = real
    // agent/supervisor accounts) applies to both, so admin/test accounts
    // stay hidden.
    const isSuperAdmin = !!(req.session && req.session.user && req.session.user.superAdmin);
    const list = users
      .filter((u) => isSuperAdmin || !u.supervisor)
      .filter((u) => String(u.rcExtension ?? '').startsWith('82'))
      .map((u) => {
        const row = {
          id: u.id,
          name: `${u.nameFirst || ''} ${u.nameLast || ''}`.trim() || u.email || u.id,
          email: u.email || '',
          preferredBreakTimer: Number.isFinite(u.preferredBreakTimer) ? u.preferredBreakTimer : 120,
          preferredLunchTimer: Number.isFinite(u.preferredLunchTimer) ? u.preferredLunchTimer : 600,
        };
        for (const { key } of USER_FLAGS) row[key] = !!u[key];
        return row;
      });
    list.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ flags: USER_FLAGS, users: list });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user flags' });
  }
});

router.put('/api/users/:id/flags', requireSupervisor, async (req, res) => {
  try {
    const payload = req.body || {};
    const updates = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!USER_FLAG_KEY_SET.has(key)) {
        return res.status(400).json({ error: `Unknown flag: ${key}` });
      }
      updates[key] = !!value;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid flag updates provided' });
    }
    const updated = await atp.users.update(req.params.id, updates);
    res.json({ id: req.params.id, updated: updates, user: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user flags' });
  }
});

router.put('/api/users/:id/reminders', requireSupervisor, async (req, res) => {
  const { updates, error } = parseReminderUpdates(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const updated = await atp.users.update(req.params.id, updates);
    res.json({ id: req.params.id, updated, user: updated });
  } catch {
    res.status(500).json({ error: 'Failed to update reminders' });
  }
});

// Self-service reminders (any authenticated user — edits their own record)
router.get('/api/me/reminders', async (req, res) => {
  try {
    const fresh = await atp.users.fetchOne(req.session.user.id);
    res.json({
      preferredBreakTimer: Number.isFinite(fresh?.preferredBreakTimer) ? fresh.preferredBreakTimer : 120,
      preferredLunchTimer: Number.isFinite(fresh?.preferredLunchTimer) ? fresh.preferredLunchTimer : 600,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load reminders' });
  }
});

router.put('/api/me/reminders', async (req, res) => {
  const { updates, error } = parseReminderUpdates(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const updated = await atp.users.update(req.session.user.id, updates);
    // Mirror into session so subsequent reads stay consistent within this session.
    Object.assign(req.session.user, updates);
    res.json({ updated, user: updated });
  } catch {
    res.status(500).json({ error: 'Failed to update reminders' });
  }
});

// SuperAdmin: break late-notification buffer (seconds)
router.get('/api/settings/breakLateBuffer', async (req, res) => {
  if (!req.session?.user?.superAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    const seconds = await getBufferSeconds();
    res.json({ seconds, defaultSeconds: DEFAULT_BUFFER_SECONDS });
  } catch {
    res.status(500).json({ error: 'Failed to load break late buffer' });
  }
});

router.put('/api/settings/breakLateBuffer', async (req, res) => {
  if (!req.session?.user?.superAdmin) return res.status(403).json({ error: 'Forbidden' });
  const n = Number(req.body?.seconds);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    return res.status(400).json({ error: 'seconds must be a non-negative integer' });
  }
  try {
    await setBufferSeconds(n);
    res.json({ seconds: n });
  } catch {
    res.status(500).json({ error: 'Failed to save break late buffer' });
  }
});

// SuperAdmin-only settings endpoints
router.get('/api/settings/visibility', async (req, res) => {
  if (!req.session?.user?.superAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    const config = await getVisibilityConfig();
    const users = await atp.users.fetchAll({});
    const userList = users.map((u) => ({ id: u.id, name: `${u.nameFirst} ${u.nameLast}`.trim() }));
    res.json({ config, users: userList, featureTiers: FEATURE_TIERS });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch visibility settings' });
  }
});

router.put('/api/settings/visibility', async (req, res) => {
  if (!req.session?.user?.superAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    const newConfig = req.body;
    // Validate structure
    for (const key of FEATURES) {
      const tiers = FEATURE_TIERS[key] || [];
      if (!newConfig[key] || !tiers.includes(newConfig[key].visibility)) {
        return res.status(400).json({ error: `Invalid visibility for ${key}` });
      }
      if (!Array.isArray(newConfig[key].approvedUsers)) {
        newConfig[key].approvedUsers = [];
      }
    }
    const existing = await atp.settings.fetchOne({ key: 'dashboardVisibility' });
    if (existing) {
      await atp.settings.update(existing.id, { value: JSON.stringify(newConfig) });
    } else {
      await atp.settings.create({ key: 'dashboardVisibility', value: JSON.stringify(newConfig) });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update visibility settings' });
  }
});

// SuperAdmin: Slack channels map (name → channel id or #name)
router.get('/api/settings/channels', async (req, res) => {
  if (!req.session?.user?.superAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    const setting = await atp.settings.fetchOne({ key: 'channels' });
    const raw = setting?.value;
    const value = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    res.json({ channels: value });
  } catch {
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

router.put('/api/settings/channels', async (req, res) => {
  if (!req.session?.user?.superAdmin) return res.status(403).json({ error: 'Forbidden' });
  const incoming = req.body?.channels;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'channels must be an object' });
  }
  const cleaned = {};
  for (const [rawName, rawId] of Object.entries(incoming)) {
    const name = String(rawName || '').trim();
    const id = String(rawId ?? '').trim();
    if (!name || !id) return res.status(400).json({ error: 'Every channel needs a name and an id' });
    if (Object.prototype.hasOwnProperty.call(cleaned, name)) {
      return res.status(400).json({ error: `Duplicate channel name: ${name}` });
    }
    cleaned[name] = id;
  }
  try {
    const existing = await atp.settings.fetchOne({ key: 'channels' });
    if (existing) {
      await atp.settings.update(existing.id, { value: cleaned });
    } else {
      await atp.settings.create({ key: 'channels', value: cleaned });
    }
    res.json({ channels: cleaned });
  } catch {
    res.status(500).json({ error: 'Failed to save channels' });
  }
});

// Tracked-issues ticker loop duration (seconds). Global setting; read by all
// clients so the marquee speed stays in sync. Only super_admins can change it.
router.get('/api/settings/trackedIssuesTickerSpeed', async (req, res) => {
  try {
    const setting = await atp.settings.fetchOne({ key: 'tracked-issues-ticker-speed' });
    const raw = setting && setting.value;
    const value = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    const seconds = Number.isFinite(value.seconds) ? value.seconds : 60;
    res.json({ seconds, defaultSeconds: 60 });
  } catch {
    res.status(500).json({ error: 'Failed to load ticker speed setting' });
  }
});

router.put('/api/settings/trackedIssuesTickerSpeed', async (req, res) => {
  if (!req.session?.user?.superAdmin) return res.status(403).json({ error: 'Forbidden' });
  const n = Number(req.body?.seconds);
  if (!Number.isFinite(n) || n < 5 || n > 600 || Math.floor(n) !== n) {
    return res.status(400).json({ error: 'seconds must be an integer between 5 and 600' });
  }
  try {
    const existing = await atp.settings.fetchOne({ key: 'tracked-issues-ticker-speed' });
    if (existing) {
      await atp.settings.update(existing.id, { value: JSON.stringify({ seconds: n }) });
    } else {
      await atp.settings.create({ key: 'tracked-issues-ticker-speed', value: JSON.stringify({ seconds: n }) });
    }
    res.json({ seconds: n });
  } catch {
    res.status(500).json({ error: 'Failed to save ticker speed' });
  }
});

// --- Announcements ---

function userDisplayName(u) {
  return `${u.nameFirst || ''} ${u.nameLast || ''}`.trim() || u.email || u.id;
}

router.get('/api/announcements/all', async (req, res) => {
  try {
    const [list, users] = await Promise.all([
      atp.announcements.fetchAll({}),
      atp.users.fetchAll({}),
    ]);
    const userById = new Map((users || []).map((u) => [u.id, userDisplayName(u)]));
    const isSup = !!(req.session.user.superAdmin || req.session.user.supervisor);
    const eligible = isSup
      ? (users || [])
          .filter((u) => !u.supervisor)
          .filter((u) => String(u.rcExtension ?? '').startsWith('82'))
      : null;
    const myId = req.session.user.id;
    const enriched = await Promise.all(
      (list || []).map(async (a) => {
        let acks = [];
        try {
          acks = (await atp.announcements.fetchAcks(a.id)) || [];
        } catch {}
        const acknowledgedByMe = acks.some((ack) => ack.userId === myId);
        const base = {
          ...a,
          createdByName: userById.get(a.createdBy) || 'Unknown',
          acknowledgedByMe,
          ackCount: acks.length,
        };
        if (isSup && eligible) {
          const ackById = new Map(acks.map((ack) => [ack.userId, ack.ackedAt]));
          const acknowledged = [];
          const pending = [];
          for (const u of eligible) {
            const row = { userId: u.id, name: userDisplayName(u) };
            if (ackById.has(u.id)) acknowledged.push({ ...row, ackedAt: ackById.get(u.id) });
            else pending.push(row);
          }
          acknowledged.sort((a, b) => a.name.localeCompare(b.name));
          pending.sort((a, b) => a.name.localeCompare(b.name));
          base.acknowledged = acknowledged;
          base.pending = pending;
          base.eligibleCount = eligible.length;
        }
        return base;
      })
    );
    enriched.sort((a, b) => {
      if (!!a.active !== !!b.active) return a.active ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    res.json({ announcements: enriched });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

router.get('/api/announcements', async (req, res) => {
  try {
    const list = await atp.announcements.fetchAll({ active: true });
    const userId = req.session.user.id;
    const enriched = await Promise.all(
      (list || []).map(async (a) => {
        let acknowledgedByMe = false;
        try {
          const acks = await atp.announcements.fetchAcks(a.id);
          acknowledgedByMe = (acks || []).some((ack) => ack.userId === userId);
        } catch {}
        return { ...a, acknowledgedByMe };
      })
    );
    enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ announcements: enriched });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

router.post('/api/announcements', requireSupervisor, async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  if (title.length > 200) return res.status(400).json({ error: 'title must be 200 chars or fewer' });
  try {
    const created = await atp.announcements.create({
      title,
      body,
      createdBy: req.session.user.id,
    });
    // Fire-and-forget Slack canvas post.
    ava.announcements
      .post(title, body, userDisplayName(req.session.user))
      .catch((err) => announcementsLogger.error({ err: err.message }, 'AVA announcement post failed'));
    // Push to all open dashboards.
    websocket.broadcast().catch(() => {});
    res.json(created);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

router.delete('/api/announcements/:id', requireSupervisor, async (req, res) => {
  try {
    await atp.announcements.update(req.params.id, { active: false });
    websocket.broadcast().catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear announcement' });
  }
});

router.post('/api/announcements/:id/ack', async (req, res) => {
  try {
    await atp.announcements.acknowledge(req.params.id, req.session.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to acknowledge announcement' });
  }
});

router.get('/api/announcements/:id/acks', requireSupervisor, async (req, res) => {
  try {
    const [acks, users] = await Promise.all([
      atp.announcements.fetchAcks(req.params.id),
      atp.users.fetchAll({}),
    ]);
    const eligible = (users || [])
      .filter((u) => !u.supervisor)
      .filter((u) => String(u.rcExtension ?? '').startsWith('82'));
    const ackById = new Map((acks || []).map((a) => [a.userId, a.ackedAt]));
    const acknowledged = [];
    const pending = [];
    for (const u of eligible) {
      const row = { userId: u.id, name: userDisplayName(u) };
      if (ackById.has(u.id)) {
        acknowledged.push({ ...row, ackedAt: ackById.get(u.id) });
      } else {
        pending.push(row);
      }
    }
    acknowledged.sort((a, b) => a.name.localeCompare(b.name));
    pending.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ acknowledged, pending });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch announcement acks' });
  }
});


// -------- Tracked issues --------
// Fields accepted in create/update (mirrors ATP whitelist minus id/timestamps/createdBy).
const TRACKED_ISSUE_FIELDS = [
  'summary',
  'incidentDate',
  'severity',
  'status',
  'description',
  'dealerInfo',
  'whatToLookFor',
  'state',
];
const TRACKED_ISSUE_STATES = new Set(['open', 'fix_incoming', 'resolved']);

function pickTrackedIssueFields(body) {
  const out = {};
  for (const k of TRACKED_ISSUE_FIELDS) {
    if (k in body) out[k] = body[k];
  }
  return out;
}

// Active only. Anyone signed in can read; the ticker is gated at the UI layer
// by the user's tracked_issues_ticker flag.
router.get('/api/tracked-issues', async (req, res) => {
  try {
    const list = await atp.trackedIssues.fetchAll({ active: true });
    res.json({ trackedIssues: list || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tracked issues' });
  }
});

// All (active + resolved) — supervisors only, for the management page.
// The management page is available to any user with the trackedIssuesTicker
// flag (matches the ticker's per-user gate); supervisors and super_admins
// keep access unconditionally.
router.get('/api/tracked-issues/all', (req, res, next) => {
  const u = req.session && req.session.user;
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (u.trackedIssuesTicker || u.supervisor || u.superAdmin) return next();
  return res.status(403).json({ error: 'Forbidden' });
}, async (req, res) => {
  try {
    const list = await atp.trackedIssues.fetchAll({});
    res.json({ trackedIssues: list || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tracked issues' });
  }
});

router.get('/api/tracked-issues/:id', async (req, res) => {
  try {
    const issue = await atp.trackedIssues.fetchOne(req.params.id);
    if (!issue) return res.status(404).json({ error: 'Tracked issue not found' });
    res.json(issue);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tracked issue' });
  }
});

router.post('/api/tracked-issues', requireSupervisor, async (req, res) => {
  const fields = pickTrackedIssueFields(req.body || {});
  const summary = String(fields.summary || '').trim();
  if (!summary) return res.status(400).json({ error: 'summary is required' });
  if (summary.length > 200) return res.status(400).json({ error: 'summary must be 200 chars or fewer' });
  fields.summary = summary;
  if (fields.state && !TRACKED_ISSUE_STATES.has(fields.state)) {
    return res.status(400).json({ error: 'invalid state' });
  }
  if (fields.state) fields.active = fields.state !== 'resolved';
  try {
    const created = await atp.trackedIssues.create({
      ...fields,
      createdBy: req.session.user.id,
    });
    // Async: append to the Slack canvas AND persist the returned sectionId
    // so Delete can later remove that specific block. Failures are logged
    // but never block the caller — the DB row is already created.
    ava.trackedIssues
      .post({
        ...fields,
        createdByName: userDisplayName(req.session.user),
        issueId: created.id,
      })
      .then((r) => {
        const mapping = r && r.mapping && typeof r.mapping === 'object' ? r.mapping : null;
        const hasSomething = mapping && ((Array.isArray(mapping.all) && mapping.all.length) || (mapping.fields && Object.keys(mapping.fields).length));
        if (hasSomething) {
          return atp.trackedIssues
            .update(created.id, { canvasSectionId: mapping })
            .catch((err) => trackedIssuesLogger.error({ err: err.message, id: created.id }, 'Failed to persist canvasSectionId'));
        }
      })
      .catch((err) => trackedIssuesLogger.error({ err: err.message }, 'AVA tracked-issue post failed'));
    websocket.broadcast().catch(() => {});
    res.json(created);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create tracked issue' });
  }
});

// Fields that map to canvas sections. Diffing the incoming patch against
// the current row on these keys tells us which section updates to send to
// AVA. `active` is a DB-only lifecycle flag and stays out of the canvas.
const CANVAS_MIRRORED_FIELDS = ['summary','incidentDate','severity','status','description','dealerInfo','whatToLookFor'];

router.patch('/api/tracked-issues/:id', requireSupervisor, async (req, res) => {
  const patch = pickTrackedIssueFields(req.body || {});
  if ('active' in (req.body || {})) patch.active = !!req.body.active;
  if (patch.state && !TRACKED_ISSUE_STATES.has(patch.state)) {
    return res.status(400).json({ error: 'invalid state' });
  }
  // State is the source of truth; keep active in sync so the ticker filter
  // (which queries active=true) stays correct.
  if (patch.state) patch.active = patch.state !== 'resolved';
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  try {
    const before = await atp.trackedIssues.fetchOne(req.params.id);
    const updated = await atp.trackedIssues.update(req.params.id, patch);
    websocket.broadcast().catch(() => {});

    // Push changed canvas-mirrored fields to Slack in place — but only if
    // this row has a mapping (row was created via the feature OR backfilled).
    const mapping = before && before.canvasSectionId;
    const hasMapping = mapping && typeof mapping === 'object' && !Array.isArray(mapping)
      && mapping.fields && Object.keys(mapping.fields).length;
    if (hasMapping) {
      const canvasUpdates = {};
      for (const key of CANVAS_MIRRORED_FIELDS) {
        if (!(key in patch)) continue;
        const prev = before[key] == null ? null : before[key];
        const next = patch[key] == null ? null : patch[key];
        if (String(prev) === String(next)) continue;
        canvasUpdates[key] = next;
      }
      if (Object.keys(canvasUpdates).length) {
        ava.trackedIssues
          .patch(mapping, canvasUpdates)
          .then((r) => {
            trackedIssuesLogger.info({ id: req.params.id, ok: r && r.ok, failures: (r && r.failures) || null, hasMapping: !!(r && r.mapping) }, 'AVA canvas patch responded');
            if (!r || !r.mapping) return;
            const oldStr = JSON.stringify(mapping || null);
            const newStr = JSON.stringify(r.mapping);
            const changed = oldStr !== newStr;
            trackedIssuesLogger.info({ id: req.params.id, changed, oldLen: oldStr.length, newLen: newStr.length }, 'Mapping change check');
            if (!changed) return;
            return atp.trackedIssues
              .update(req.params.id, { canvasSectionId: r.mapping })
              .then(() => trackedIssuesLogger.info({ id: req.params.id }, 'Persisted updated canvas mapping'))
              .catch((err) => trackedIssuesLogger.error({ err: err.message, id: req.params.id }, 'Failed to persist updated canvas mapping'));
          })
          .catch((err) => trackedIssuesLogger.error({ err: err.message, id: req.params.id }, 'AVA canvas patch failed'));
      }
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update tracked issue' });
  }
});

// Hard delete — supervisor-only. Close (soft-hide) is available via PATCH
// { active: false }; this endpoint fully removes the row from ATP and, if
// we recorded a canvas section id at create time, removes that block from
// the Slack canvas too (fire-and-forget — canvas failure never blocks DB
// delete).
router.delete('/api/tracked-issues/:id', requireSupervisor, async (req, res) => {
  try {
    const row = await atp.trackedIssues.fetchOne(req.params.id);
    // destroySections() accepts either the new {all, fields} object or the
    // legacy flat array. Only call it if something is set.
    const csid = row && row.canvasSectionId;
    const hasSections = csid && (
      (Array.isArray(csid) && csid.length) ||
      (typeof csid === 'object' && ((Array.isArray(csid.all) && csid.all.length) || (csid.fields && Object.keys(csid.fields).length)))
    );
    if (hasSections) {
      ava.trackedIssues
        .destroySections(csid)
        .catch((err) => trackedIssuesLogger.error({ err: err.message, id: req.params.id }, 'AVA tracked-issue sections delete failed'));
    }
    await atp.trackedIssues.destroy(req.params.id);
    websocket.broadcast().catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete tracked issue' });
  }
});

module.exports = router;

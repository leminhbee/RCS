const router = require('express').Router();
const dashboardController = require('../controllers/dashboard');
const reportsController = require('../controllers/reports');
const atp = require('../ATP');
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
    const list = users
      .filter((u) => !u.supervisor)
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

module.exports = router;

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

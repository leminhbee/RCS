const router = require('express').Router();
const dashboardController = require('../controllers/dashboard');
const reportsController = require('../controllers/reports');
const atp = require('../ATP');
const { getVisibilityConfig, getPermissions, FEATURES } = require('../helpers/dashboardAccess');

router.get('/api', dashboardController.getData);
router.get('/api/stats', dashboardController.getStats);
router.get('/api/reports', (req, res, next) => {
  if (!req.session?.user?.superAdmin && !req.session?.user?.supervisor) return res.status(403).json({ error: 'Forbidden' });
  next();
}, reportsController.getReports);

router.get('/api/me', async (req, res) => {
  try {
    const config = await getVisibilityConfig();
    const permissions = getPermissions(req.session.user, config);
    res.json({ ...req.session.user, permissions });
  } catch {
    res.json({ ...req.session.user, permissions: {} });
  }
});

router.delete('/api/queue/:id', dashboardController.removeQueueCall);

// SuperAdmin-only settings endpoints
router.get('/api/settings/visibility', async (req, res) => {
  if (!req.session?.user?.superAdmin) return res.status(403).json({ error: 'Forbidden' });
  try {
    const config = await getVisibilityConfig();
    const users = await atp.users.fetchAll({});
    const userList = users.map((u) => ({ id: u.id, name: `${u.nameFirst} ${u.nameLast}`.trim() }));
    res.json({ config, users: userList });
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
      if (!newConfig[key] || !['all', 'supervisors', 'approvedUsers'].includes(newConfig[key].visibility)) {
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

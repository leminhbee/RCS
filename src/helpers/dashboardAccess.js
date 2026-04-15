const atp = require('../ATP');

const FEATURES = ['stats', 'callLists', 'repeatCallers', 'agentMetrics', 'callCountByNumber'];

const DEFAULT_CONFIG = {
  stats: { visibility: 'supervisors', approvedUsers: [] },
  callLists: { visibility: 'supervisors', approvedUsers: [] },
  repeatCallers: { visibility: 'supervisors', approvedUsers: [] },
  agentMetrics: { visibility: 'supervisors', approvedUsers: [] },
  callCountByNumber: { visibility: 'supervisors', approvedUsers: [] },
};

async function getVisibilityConfig() {
  try {
    const setting = await atp.settings.fetchOne({ key: 'dashboardVisibility' });
    if (!setting?.value) return { ...DEFAULT_CONFIG };
    const parsed = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value;
    // Merge with defaults so new features always have a fallback
    const config = {};
    for (const key of FEATURES) {
      config[key] = {
        visibility: parsed[key]?.visibility || 'supervisors',
        approvedUsers: Array.isArray(parsed[key]?.approvedUsers) ? parsed[key].approvedUsers : [],
      };
    }
    return config;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function canAccess(featureConfig, user) {
  if (!featureConfig) return false;
  const { visibility, approvedUsers } = featureConfig;
  if (visibility === 'all') return true;
  if (visibility === 'supervisors') return !!user?.supervisor;
  if (visibility === 'approvedUsers') {
    return !!user?.supervisor || (Array.isArray(approvedUsers) && approvedUsers.includes(user?.id));
  }
  return false;
}

function getPermissions(user, config) {
  const perms = {};
  for (const key of FEATURES) {
    perms[key] = canAccess(config[key], user);
  }
  return perms;
}

module.exports = { getVisibilityConfig, canAccess, getPermissions, FEATURES, DEFAULT_CONFIG };

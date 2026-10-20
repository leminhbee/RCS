const atp = require('../ATP');

const FEATURES = ['stats', 'callLists', 'repeatCallers', 'agentMetrics', 'callCountByNumber', 'reports'];

// Per-feature whitelist of valid visibility tiers. `selfOnly` is only meaningful
// for features whose backend can scope data to a single user (currently: reports).
const FEATURE_TIERS = {
  stats: ['all', 'supervisors', 'approvedUsers'],
  callLists: ['all', 'supervisors', 'approvedUsers'],
  repeatCallers: ['all', 'supervisors', 'approvedUsers'],
  agentMetrics: ['all', 'supervisors', 'approvedUsers'],
  callCountByNumber: ['all', 'supervisors', 'approvedUsers'],
  reports: ['supervisors', 'approvedUsers', 'selfOnly'],
};

const DEFAULT_CONFIG = {
  stats: { visibility: 'supervisors', approvedUsers: [] },
  callLists: { visibility: 'supervisors', approvedUsers: [] },
  repeatCallers: { visibility: 'supervisors', approvedUsers: [] },
  agentMetrics: { visibility: 'supervisors', approvedUsers: [] },
  callCountByNumber: { visibility: 'supervisors', approvedUsers: [] },
  reports: { visibility: 'supervisors', approvedUsers: [] },
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
        visibility: parsed[key]?.visibility || DEFAULT_CONFIG[key].visibility,
        approvedUsers: Array.isArray(parsed[key]?.approvedUsers) ? parsed[key].approvedUsers : [],
      };
    }
    return config;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function canAccess(featureConfig, user) {
  if (!featureConfig || !user) return false;
  const isSupervisor = !!(user.supervisor || user.superAdmin);
  const { visibility, approvedUsers } = featureConfig;
  if (visibility === 'all') return true;
  if (visibility === 'selfOnly') return true;
  if (visibility === 'supervisors') return isSupervisor;
  if (visibility === 'approvedUsers') {
    return isSupervisor || (Array.isArray(approvedUsers) && approvedUsers.includes(user.id));
  }
  return false;
}

// Whether the user should see team-wide data, vs. only their own.
// Supervisors/admins always see team data regardless of the tier — `selfOnly`
// scopes only non-supervisor users to their own userId.
function canViewAllUsers(featureConfig, user) {
  if (!featureConfig || !user) return false;
  const isSupervisor = !!(user.supervisor || user.superAdmin);
  const { visibility, approvedUsers } = featureConfig;
  if (visibility === 'all') return true;
  if (visibility === 'selfOnly') return isSupervisor;
  if (visibility === 'supervisors') return isSupervisor;
  if (visibility === 'approvedUsers') {
    return isSupervisor || (Array.isArray(approvedUsers) && approvedUsers.includes(user.id));
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

function getViewScopes(user, config) {
  const scopes = {};
  for (const key of FEATURES) {
    scopes[key] = canViewAllUsers(config[key], user) ? 'all' : 'self';
  }
  return scopes;
}

module.exports = {
  getVisibilityConfig,
  canAccess,
  canViewAllUsers,
  getPermissions,
  getViewScopes,
  FEATURES,
  FEATURE_TIERS,
  DEFAULT_CONFIG,
};

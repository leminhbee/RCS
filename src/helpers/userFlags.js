// Boolean per-user feature flags exposed in the dashboard "User Permissions" modal.
// Add a new entry here and it shows up in the UI and is accepted by the PUT endpoint —
// nothing else needs to change. Keep keys in sync with the ATP users table columns.
//
// Intentionally excluded:
//   - supervisor, superAdmin     (role grants — different access tier)
//   - passwordResetRequired      (transient state, not a feature gate)
const USER_FLAGS = [
  { key: 'callsActive',          label: 'Calls Active',          description: 'Agent receives inbound calls.' },
  { key: 'statusesActive',       label: 'Statuses Active',       description: 'Status webhooks update this user.' },
  { key: 'ssoEnabled',           label: 'SSO Enabled',           description: 'User signs in via Microsoft SSO.' },
  { key: 'deviceAdmin',          label: 'Device Admin',          description: 'Grants access to the device status fixing tool in AVA (Slack command).' },
  { key: 'startTransferRequest', label: 'Start Transfer Request', description: 'May initiate transfer requests.' },
  { key: 'breaksEnabled',        label: 'Breaks Enabled',        description: 'Records breaks with reminders + late tracking.' },
];

const USER_FLAG_KEYS = USER_FLAGS.map((f) => f.key);
const USER_FLAG_KEY_SET = new Set(USER_FLAG_KEYS);

module.exports = { USER_FLAGS, USER_FLAG_KEYS, USER_FLAG_KEY_SET };

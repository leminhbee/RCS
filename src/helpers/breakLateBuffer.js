// Wait this long after a break's cap (60 min lunch / 15 min break) before
// sending the late-notification Slack messages. `late: true` on the record is
// still flipped at the cap; only the notifications are delayed.
//
// Stored as a string of seconds in the atp.settings table under the key below.
const atp = require('../ATP');

const SETTING_KEY = 'breakLateBuffer';
const DEFAULT_BUFFER_SECONDS = 120;

async function getBufferSeconds() {
  try {
    const setting = await atp.settings.fetchOne({ key: SETTING_KEY });
    const n = Number(setting?.value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_BUFFER_SECONDS;
  } catch {
    return DEFAULT_BUFFER_SECONDS;
  }
}

async function setBufferSeconds(seconds) {
  const value = String(Math.max(0, Math.round(Number(seconds) || 0)));
  const existing = await atp.settings.fetchOne({ key: SETTING_KEY });
  if (existing) {
    await atp.settings.update(existing.id, { value });
  } else {
    await atp.settings.create({ key: SETTING_KEY, value });
  }
}

module.exports = { getBufferSeconds, setBufferSeconds, DEFAULT_BUFFER_SECONDS, SETTING_KEY };

// New-hire onboarding flow. Self-initializes on the shared rcs:user-loaded
// event dispatched by topbar.js, and skips silently if the modal partial isn't
// included on the current page — same contract as user-flags-panel.js.
//
// Three steps: enter name + email, confirm what the lookup found, create.
// Every resolved value stays editable, because a lookup that matched on the
// local part of an email (the roster carries both @alula.net and
// @m2mservices.com) is a strong hint, not proof.

(() => {

// Mirrors USER_FLAGS in src/helpers/userFlags.js. Only the ones worth setting at
// create time — the rest default false and live in the User Permissions modal.
const ONBOARDING_FLAGS = [
  { key: 'callsActive', label: 'Calls Active', default: true },
  { key: 'statusesActive', label: 'Statuses Active', default: true },
  { key: 'ssoEnabled', label: 'SSO Enabled', default: true },
  { key: 'breaksEnabled', label: 'Breaks Enabled', default: true },
  { key: 'trackedIssuesTicker', label: 'Tracked Issues Ticker', default: false },
  { key: 'startTransferRequest', label: 'Start Transfer Request', default: false },
  { key: 'deviceAdmin', label: 'Device Admin', default: false },
];

// Order and labels for the confirm table. `editable` fields render as inputs.
const FIELD_ROWS = [
  { key: 'rcId', label: 'RingCX Agent ID' },
  { key: 'rcExtension', label: 'RingEX Extension' },
  { key: 'sfdcId', label: 'Salesforce ID' },
  { key: 'slackId', label: 'Slack ID' },
  { key: 'alulaConnectId', label: 'Alula Connect ID' },
  { key: 'microsoftId', label: 'Microsoft ID' },
];

const CONFIDENCE_LABEL = {
  exact: { text: 'exact match', cls: 'ok' },
  'local-part': { text: 'same mailbox, different domain', cls: 'warn' },
  name: { text: 'matched on name only', cls: 'warn' },
  none: { text: 'not found', cls: 'none' },
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function initOnboardingPanel() {
  const modalEl = document.getElementById('onboarding-modal');
  if (!modalEl) return;

  const basePath = location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');
  const stepIdentity = document.getElementById('onboarding-step-identity');
  const stepConfirm = document.getElementById('onboarding-step-confirm');
  const firstEl = document.getElementById('onboarding-first');
  const lastEl = document.getElementById('onboarding-last');
  const emailEl = document.getElementById('onboarding-email');
  const summaryEl = document.getElementById('onboarding-summary');
  const warningsEl = document.getElementById('onboarding-warnings');
  const fieldsEl = document.getElementById('onboarding-fields');
  const flagListEl = document.getElementById('onboarding-flag-list');
  const feedback = document.getElementById('onboarding-feedback');
  const lookupBtn = document.getElementById('onboarding-lookup-btn');
  const createBtn = document.getElementById('onboarding-create-btn');
  const backBtn = document.getElementById('onboarding-back-btn');

  let resolved = null;

  const say = (msg, cls) => {
    feedback.textContent = msg || '';
    feedback.className = 'settings-feedback' + (cls ? ' ' + cls : '');
  };

  function showStep(which) {
    const confirming = which === 'confirm';
    stepIdentity.style.display = confirming ? 'none' : '';
    stepConfirm.style.display = confirming ? '' : 'none';
    lookupBtn.style.display = confirming ? 'none' : '';
    createBtn.style.display = confirming ? '' : 'none';
    backBtn.style.display = confirming ? '' : 'none';
  }

  function reset() {
    resolved = null;
    firstEl.value = '';
    lastEl.value = '';
    emailEl.value = '';
    fieldsEl.innerHTML = '';
    warningsEl.innerHTML = '';
    summaryEl.innerHTML = '';
    say('');
    showStep('identity');
  }

  function renderFlags() {
    flagListEl.innerHTML = ONBOARDING_FLAGS.map((f) => `
      <label class="onboarding-flag">
        <input type="checkbox" data-flag="${esc(f.key)}" ${f.default ? 'checked' : ''}>
        <span>${esc(f.label)}</span>
      </label>`).join('');
  }

  function renderConfirm(result) {
    const name = `${firstEl.value.trim()} ${lastEl.value.trim()}`.trim();
    summaryEl.innerHTML = `<strong>${esc(name)}</strong> &lt;${esc(emailEl.value.trim())}&gt;`;

    const warnings = [];
    if (result.existing) {
      warnings.push(`<div class="onboarding-warn danger">An account already exists for this person: <strong>${esc(result.existing.name)}</strong> &lt;${esc(result.existing.email)}&gt;${result.existing.active === false ? ' (deactivated)' : ''}. Creating another will make every email lookup ambiguous.</div>`);
    }
    for (const [source, message] of Object.entries(result.errors || {})) {
      warnings.push(`<div class="onboarding-warn">Lookup failed for <strong>${esc(source)}</strong>: ${esc(message)}. Enter those values by hand or try again.</div>`);
    }
    // A domain mismatch is the single most common cause of a wrong match here,
    // and it is also what breaks SSO later, so call it out explicitly.
    const ringex = result.fields.rcExtension;
    if (ringex && ringex.confidence === 'local-part' && ringex.detail) {
      const m = ringex.detail.match(/<([^>]+)>/);
      if (m && m[1] && m[1].toLowerCase() !== emailEl.value.trim().toLowerCase()) {
        warnings.push(`<div class="onboarding-warn">RingCentral has them as <strong>${esc(m[1])}</strong>, which is a different domain to the address you entered. Use whichever one their Microsoft sign-in uses.</div>`);
      }
    }
    warningsEl.innerHTML = warnings.join('');

    fieldsEl.innerHTML = FIELD_ROWS.map((row) => {
      const f = result.fields[row.key] || { value: null, confidence: 'none', detail: null, source: '' };
      const conf = CONFIDENCE_LABEL[f.confidence] || CONFIDENCE_LABEL.none;
      const alternates = f.alternates && f.alternates.length > 1
        ? `<select class="form-select form-select-sm onboarding-alt" data-field="${esc(row.key)}">
             ${f.alternates.map((a) => `<option value="${esc(a.value)}"${a.value === f.value ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}
           </select>`
        : '';
      const readOnly = row.key === 'microsoftId';
      return `<tr>
        <td class="onboarding-label">${esc(row.label)}</td>
        <td>
          <input type="text" class="form-control form-control-sm onboarding-value"
                 data-field="${esc(row.key)}" value="${esc(f.value)}"
                 ${readOnly ? 'disabled placeholder="set on first sign-in"' : ''}>
          ${alternates}
        </td>
        <td class="onboarding-source">
          <span class="onboarding-conf ${conf.cls}">${esc(conf.text)}</span>
          ${f.detail ? `<div class="onboarding-detail">${esc(f.detail)}</div>` : ''}
        </td>
      </tr>`;
    }).join('');

    // Picking an alternate rewrites the value input it belongs to.
    fieldsEl.querySelectorAll('.onboarding-alt').forEach((sel) => {
      sel.addEventListener('change', () => {
        const input = fieldsEl.querySelector(`.onboarding-value[data-field="${sel.dataset.field}"]`);
        if (input) input.value = sel.value;
      });
    });

    renderFlags();
    showStep('confirm');
  }

  async function doLookup() {
    const nameFirst = firstEl.value.trim();
    const nameLast = lastEl.value.trim();
    const email = emailEl.value.trim();
    if (!nameFirst || !nameLast) return say('First and last name are required.', 'error');
    if (!email || !email.includes('@')) return say('A valid email address is required.', 'error');

    lookupBtn.disabled = true;
    say('Looking up RingCX, RingEX, Salesforce and Slack...');
    try {
      const r = await fetch(`${basePath}/api/users/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nameFirst, nameLast, email }),
      });
      const data = await r.json();
      if (!r.ok) return say(data.error || 'Lookup failed.', 'error');
      resolved = data;
      renderConfirm(data);
      const found = FIELD_ROWS.filter((row) => data.fields[row.key] && data.fields[row.key].value != null).length;
      say(`Found ${found} of ${FIELD_ROWS.length}. Check each value, then create.`);
    } catch (e) {
      say('Lookup failed: ' + e.message, 'error');
    } finally {
      lookupBtn.disabled = false;
    }
  }

  async function doCreate() {
    if (!resolved) return;
    const payload = {
      nameFirst: firstEl.value.trim(),
      nameLast: lastEl.value.trim(),
      email: emailEl.value.trim(),
    };
    fieldsEl.querySelectorAll('.onboarding-value').forEach((input) => {
      if (input.disabled) return;
      const v = input.value.trim();
      if (v) payload[input.dataset.field] = v;
    });
    flagListEl.querySelectorAll('input[data-flag]').forEach((cb) => {
      payload[cb.dataset.flag] = cb.checked;
    });

    if (resolved.existing && !confirm(`An account already exists for ${resolved.existing.email}.\n\nCreate a second one anyway?`)) return;

    createBtn.disabled = true;
    say('Creating user...');
    try {
      const r = await fetch(`${basePath}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) return say(data.error || 'Failed to create user.', 'error');
      say(`Created ${payload.nameFirst} ${payload.nameLast}. They can sign in with Microsoft SSO.`, 'ok');
      createBtn.disabled = true;
      setTimeout(() => {
        bootstrap.Modal.getInstance(modalEl)?.hide();
      }, 1600);
    } catch (e) {
      say('Failed to create user: ' + e.message, 'error');
      createBtn.disabled = false;
    }
  }

  lookupBtn.addEventListener('click', doLookup);
  createBtn.addEventListener('click', doCreate);
  backBtn.addEventListener('click', () => { showStep('identity'); say(''); });
  modalEl.addEventListener('hidden.bs.modal', () => { createBtn.disabled = false; reset(); });
  emailEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLookup(); });
}

window.addEventListener('rcs:user-loaded', (e) => {
  if (!document.getElementById('onboarding-modal')) return;
  const user = e.detail || (window.rcs && window.rcs.currentUser) || null;
  if (!user || !(user.supervisor || user.superAdmin)) return;
  initOnboardingPanel();
});

})();

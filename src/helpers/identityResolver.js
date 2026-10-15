const rc = require('./ringcentral');
const alulaConnect = require('./alulaConnect');
const ava = require('../AVA');
const atp = require('../ATP');
const { sfdcConn } = require('../config/sfdc');

// Resolves the external system IDs we store on an ATP user from nothing but a
// name and an email address, so onboarding a new hire is a confirm step rather
// than six manual lookups.
//
// Nothing here writes to any external system — every call is a read.
//
// The hard part is that the systems disagree about email. ATP carries a mix of
// @m2mservices.com and @alula.net (a rename that was never backfilled) while
// RingEX, Salesforce and Slack are all @alula.net. So a plain email equality
// check misses roughly half the roster. We try progressively weaker matches and
// report which one landed, because "matched on the local part, domain differs"
// is exactly the kind of thing a supervisor should eyeball before saving.

const CONFIDENCE = {
  EXACT: 'exact', // email matched in full
  LOCAL: 'local-part', // same mailbox, different domain
  NAME: 'name', // first + last matched, email did not
  NONE: 'none',
};

const localPart = (e) => String(e || '').trim().toLowerCase().split('@')[0];
const normEmail = (e) => String(e || '').trim().toLowerCase();
const normName = (s) => String(s || '').trim().toLowerCase();

// The company renamed from M2M Services to Alula, and accounts in the external
// systems were re-created on @alula.net without the @m2mservices.com originals
// being cleaned up. Slack in particular still has live duplicates — searching
// aj.ferrer@m2mservices.com returns `aj.ferrer458`, a second active account,
// while the real one is `aj.ferrer` on @alula.net. So the current domain is
// tried first regardless of which address was typed, and anything else found is
// offered as an alternate rather than silently discarded.
const PREFERRED_DOMAINS = ['alula.net', 'm2mservices.com'];

function emailCandidates(email) {
  const typed = normEmail(email);
  if (!typed) return [];
  const local = localPart(email);
  const out = [];
  for (const domain of PREFERRED_DOMAINS) {
    const candidate = `${local}@${domain}`;
    if (!out.includes(candidate)) out.push(candidate);
  }
  if (!out.includes(typed)) out.push(typed);
  return out;
}

/**
 * Find one person in a list from another system.
 * @param {Array} records
 * @param {{email:string, nameFirst:string, nameLast:string}} person
 * @param {(r:any)=>string} getEmail
 * @param {(r:any)=>{first:string,last:string}} getName
 * @returns {{record:any, confidence:string}|null}
 */
function matchPerson(records, person, getEmail, getName) {
  const wantEmail = normEmail(person.email);
  const wantLocal = localPart(person.email);
  const wantFirst = normName(person.nameFirst);
  const wantLast = normName(person.nameLast);

  if (wantEmail) {
    const exact = records.find((r) => normEmail(getEmail(r)) === wantEmail);
    if (exact) return { record: exact, confidence: CONFIDENCE.EXACT };
  }
  if (wantLocal) {
    const byLocal = records.filter((r) => localPart(getEmail(r)) === wantLocal);
    if (byLocal.length === 1) return { record: byLocal[0], confidence: CONFIDENCE.LOCAL };
  }
  if (getName && wantFirst && wantLast) {
    const byName = records.filter((r) => {
      const n = getName(r) || {};
      return normName(n.first) === wantFirst && normName(n.last) === wantLast;
    });
    if (byName.length === 1) return { record: byName[0], confidence: CONFIDENCE.NAME };
  }
  return null;
}

const field = (value, source, confidence, detail, extra) => ({
  value: value ?? null,
  source,
  confidence: value == null ? CONFIDENCE.NONE : confidence,
  detail: detail || null,
  ...(extra || {}),
});

// --- RingEX extension, then the RingCX agent joined to it -------------------
// RingCX agents carry `rcUserId`, which is the RingEX extension's id. That join
// is exact, so the only fuzzy step is finding the extension in the first place.
async function resolveRingCentral(person) {
  if (!rc.hasCredentials()) {
    return {
      rcExtension: field(null, 'RingEX', null, 'RingCentral credentials not configured'),
      rcId: field(null, 'RingCX', null, 'RingCentral credentials not configured'),
    };
  }

  const extensions = await rc.listExtensions();
  const hit = matchPerson(
    extensions,
    person,
    (e) => e.email,
    (e) => {
      const parts = String(e.name || '').trim().split(/\s+/);
      return { first: parts[0], last: parts.slice(1).join(' ') };
    }
  );

  if (!hit) {
    return {
      rcExtension: field(null, 'RingEX', null, 'No RingEX extension matched this person'),
      rcId: field(null, 'RingCX', null, 'Needs a RingEX extension first'),
    };
  }

  const ext = hit.record;
  const extField = field(
    ext.extensionNumber ? String(ext.extensionNumber) : null,
    'RingEX',
    hit.confidence,
    `${ext.name || 'unnamed'} <${ext.email || 'no email'}> (extension id ${ext.id})`
  );

  let agent = null;
  try {
    agent = await rc.findAgentByRcUserId(ext.id);
  } catch (error) {
    return {
      rcExtension: extField,
      rcId: field(null, 'RingCX', null, `RingCX lookup failed: ${error.message}`),
    };
  }

  if (!agent) {
    return {
      rcExtension: extField,
      rcId: field(null, 'RingCX', null, 'No RingCX agent is linked to this RingEX user — they may not be provisioned in the contact centre yet'),
    };
  }

  return {
    rcExtension: extField,
    // The join itself is exact; inherit the extension match's confidence since
    // that is the only step that could have picked the wrong person.
    rcId: field(
      agent.agentId,
      'RingCX',
      hit.confidence,
      `${agent.firstName || ''} ${agent.lastName || ''}`.trim() +
        ` — ${agent.agentType}${agent.isActive === false ? ', INACTIVE' : ''}, group ${agent.agentGroupName || agent.agentGroupId}`
    ),
  };
}

// --- Salesforce -------------------------------------------------------------
// Email is not unique here: shared/guest users exist on real addresses, so this
// can legitimately return several rows. Surface them all and let a human pick.
async function resolveSalesforce(person) {
  const email = normEmail(person.email);
  const local = localPart(person.email);
  if (!email) return { sfdcId: field(null, 'Salesforce', null, 'No email supplied') };

  await sfdcConn.authorize({ grant_type: 'client_credentials' });
  const esc = (s) => String(s).replace(/'/g, "\\'");
  const soql =
    'SELECT Id, Name, Email, Username, IsActive FROM User ' +
    `WHERE IsActive = true AND (Email = '${esc(email)}' OR Email LIKE '${esc(local)}@%') ` +
    'ORDER BY Email LIMIT 25';
  const res = await sfdcConn.query(soql);
  const rows = res.records || [];

  if (rows.length === 0) {
    return { sfdcId: field(null, 'Salesforce', null, 'No active Salesforce user matched') };
  }

  const hit = matchPerson(
    rows,
    person,
    (r) => r.Email,
    (r) => {
      const parts = String(r.Name || '').trim().split(/\s+/);
      return { first: parts[0], last: parts.slice(1).join(' ') };
    }
  );

  const alternates = rows.map((r) => ({
    value: r.Id,
    label: `${r.Name} <${r.Email}>`,
    username: r.Username,
  }));

  if (!hit) {
    return {
      sfdcId: field(null, 'Salesforce', null, `${rows.length} candidate(s) found but none matched unambiguously — pick one`, { alternates }),
    };
  }
  return {
    sfdcId: field(hit.record.Id, 'Salesforce', hit.confidence, `${hit.record.Name} <${hit.record.Email}>`, {
      alternates: alternates.length > 1 ? alternates : undefined,
    }),
  };
}

// --- Slack ------------------------------------------------------------------
// The bot token lives in AVA, so this goes over AVA's HTTP API rather than
// duplicating the credential into RCS.
async function resolveSlack(person) {
  const candidates = emailCandidates(person.email);
  if (candidates.length === 0) return { slackId: field(null, 'Slack', null, 'No email supplied') };

  const hits = [];
  for (const email of candidates) {
    const found = await ava.lookup.slackUserByEmail(email);
    if (!found || !found.id) continue;
    if (hits.some((h) => h.id === found.id)) continue; // same account on two addresses
    hits.push({ id: found.id, email, name: found.realName || found.name || 'unnamed', deleted: found.deleted });
  }

  if (hits.length === 0) {
    return { slackId: field(null, 'Slack', null, `No Slack user for ${candidates.join(' or ')}`) };
  }

  // candidates is in preference order, so hits[0] is the best address we found.
  const best = hits[0];
  const confidence = best.email === normEmail(person.email) ? CONFIDENCE.EXACT : CONFIDENCE.LOCAL;
  const alternates = hits.map((h) => ({ value: h.id, label: `${h.name} <${h.email}>${h.deleted ? ' — deactivated' : ''}` }));
  const detail = hits.length > 1
    ? `${best.name} <${best.email}> — ${hits.length} Slack accounts match this person, check which one is current`
    : `${best.name} <${best.email}>${best.deleted ? ' — DEACTIVATED' : ''}`;

  return { slackId: field(best.id, 'Slack', confidence, detail, { alternates: hits.length > 1 ? alternates : undefined }) };
}

// --- Alula Connect ----------------------------------------------------------
// Only filters on an exact email, so the domain spread is handled the same way
// as Slack: try what was typed, then the same mailbox at each known domain.
async function resolveAlulaConnect(person) {
  if (!alulaConnect.hasCredentials()) {
    return { alulaConnectId: field(null, 'Alula Connect', null, 'Alula Connect credentials not configured') };
  }
  if (!person.email) {
    return { alulaConnectId: field(null, 'Alula Connect', null, 'No email supplied') };
  }

  const typed = normEmail(person.email);
  const candidates = emailCandidates(person.email);

  for (const email of candidates) {
    const rows = await alulaConnect.findUsersByEmail(email);
    if (rows.length === 0) continue;

    const confidence = email === typed ? CONFIDENCE.EXACT : CONFIDENCE.LOCAL;
    const alternates = rows.map((u) => ({
      value: u.id,
      label: `${`${u.nameFirst || ''} ${u.nameLast || ''}`.trim() || u.username} <${u.email}>`,
    }));

    // Narrowed to staff accounts this should be a single row, but Connect has
    // no uniqueness guarantee on email, so hand the choice over if it isn't.
    if (rows.length > 1) {
      return {
        alulaConnectId: field(null, 'Alula Connect', null, `${rows.length} Connect accounts share ${email} — pick one`, { alternates }),
      };
    }
    const u = rows[0];
    return {
      alulaConnectId: field(u.id, 'Alula Connect', confidence, `${`${u.nameFirst || ''} ${u.nameLast || ''}`.trim()} <${u.email}> — ${u.username} (staff)`),
    };
  }

  return { alulaConnectId: field(null, 'Alula Connect', null, `No staff Connect account for ${candidates.join(' or ')}`) };
}

/**
 * Resolve every external ID we can for a prospective user.
 * Each source is isolated: one outage degrades a single field rather than the
 * whole flow, and the failure is reported back so the modal can show it.
 */
async function resolveIdentity({ nameFirst, nameLast, email }) {
  const person = { nameFirst, nameLast, email };

  // Each source declares the fields it owns, so a source that throws still
  // yields those keys as explicit failures. The caller can then rely on every
  // field being present and never has to distinguish "absent" from "errored".
  const sources = [
    ['ringcentral', resolveRingCentral, ['rcExtension', 'rcId'], 'RingCentral'],
    ['salesforce', resolveSalesforce, ['sfdcId'], 'Salesforce'],
    ['slack', resolveSlack, ['slackId'], 'Slack'],
    ['alulaConnect', resolveAlulaConnect, ['alulaConnectId'], 'Alula Connect'],
  ];

  const settled = await Promise.allSettled(sources.map(([, fn]) => fn(person)));

  const fields = {};
  const errors = {};
  settled.forEach((outcome, i) => {
    const [name, , owned, label] = sources[i];
    if (outcome.status === 'fulfilled') {
      Object.assign(fields, outcome.value);
      return;
    }
    const message = outcome.reason ? outcome.reason.message : 'Lookup failed';
    errors[name] = message;
    for (const key of owned) fields[key] = field(null, label, null, `Lookup failed: ${message}`);
  });

  // microsoftId is deliberately not resolved here. The SSO callback captures it
  // on first sign-in, which avoids needing Graph User.Read.All on the app
  // registration. See src/controllers/auth.js.
  fields.microsoftId = field(null, 'Microsoft', null, 'Captured automatically on their first SSO sign-in');

  // Flag a collision before the supervisor fills anything else in.
  let existing = null;
  if (email) {
    const all = await atp.users.fetchAll({});
    existing = all.find((u) => normEmail(u.email) === normEmail(email)) ||
      all.find((u) => localPart(u.email) === localPart(email)) || null;
  }

  return {
    fields,
    errors,
    existing: existing
      ? { id: existing.id, name: `${existing.nameFirst} ${existing.nameLast}`.trim(), email: existing.email, active: existing.active }
      : null,
  };
}

module.exports = { resolveIdentity, matchPerson, CONFIDENCE };

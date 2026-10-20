const RC = require('@ringcentral/sdk').SDK;
const axios = require('axios');

// RingEX (the phone platform) and RingCX (the contact centre) are two separate
// registries that happen to share one RingCentral login. A person has a RingEX
// extension keyed by email, and a RingCX agent keyed by `rcUserId` — which is
// the RingEX extension's id. That join is the only reliable way to get from an
// email address to the `agent_id` our webhooks arrive with.
//
//   email -> RingEX extension.id -> RingCX agent.rcUserId -> agent.agentId
//
// `agentId` is what ATP stores as users.rcId.

const RINGCX_AUTH_URL = 'https://engage.ringcentral.com/api/auth/login/rc/accesstoken';
const RINGCX_ADMIN_BASE = 'https://ringcx.ringcentral.com/voice/api/v1/admin';

// RingCX access tokens are good for far longer than a modal flow, but we re-auth
// well before the hour mark rather than trying to parse an expiry we don't own.
const CX_TOKEN_TTL_MS = 30 * 60 * 1000;

let platformPromise = null;
let cxSession = null; // { token, accountId, fetchedAt }

function hasCredentials() {
  return Boolean(
    process.env.RC_SERVER_URL &&
    process.env.RC_APP_CLIENT_ID &&
    process.env.RC_APP_CLIENT_SECRET &&
    process.env.RC_USER_JWT
  );
}

// One SDK login per process. The JWT grant is cheap but not free, and the SDK
// refreshes the access token itself once logged in.
function getPlatform() {
  if (!platformPromise) {
    platformPromise = (async () => {
      const sdk = new RC({
        server: process.env.RC_SERVER_URL,
        clientId: process.env.RC_APP_CLIENT_ID,
        clientSecret: process.env.RC_APP_CLIENT_SECRET,
      });
      const platform = sdk.platform();
      await platform.login({ jwt: process.env.RC_USER_JWT });
      return platform;
    })().catch((error) => {
      platformPromise = null; // let the next caller retry rather than caching a failure
      throw error;
    });
  }
  return platformPromise;
}

/**
 * Every RingEX user extension, as { id, extensionNumber, name, email }.
 * Paged because the endpoint caps perPage; the account is small but the loop
 * keeps this correct if it grows.
 */
async function listExtensions() {
  const platform = await getPlatform();
  const out = [];
  let page = 1;
  for (;;) {
    const res = await platform.get(`/restapi/v1.0/account/~/extension?type=User&perPage=100&page=${page}`);
    const body = await res.json();
    for (const r of body.records || []) {
      out.push({
        id: r.id,
        extensionNumber: r.extensionNumber,
        name: r.name,
        email: r.contact && r.contact.email ? r.contact.email : null,
      });
    }
    const paging = body.paging || {};
    if (!paging.totalPages || page >= paging.totalPages) break;
    page += 1;
  }
  return out;
}

/**
 * Exchange the RingEX access token for a RingCX one. The response also carries
 * the RingCX sub-account id, which we need for every admin call and which is not
 * the RingCentral account id.
 */
async function getCxSession() {
  if (cxSession && Date.now() - cxSession.fetchedAt < CX_TOKEN_TTL_MS) return cxSession;

  const platform = await getPlatform();
  const { access_token: rcToken } = await platform.auth().data();

  const { data } = await axios.post(
    RINGCX_AUTH_URL,
    new URLSearchParams({ rcAccessToken: rcToken, rcTokenType: 'Bearer' }),
    { timeout: 15000 }
  );

  const token = data.accessToken || data.access_token;
  if (!token) throw new Error('RingCX token exchange returned no access token');

  // agentDetails describes the service account we logged in as; its accountId is
  // the sub-account that holds every agent in this tenant.
  const self = (data.agentDetails || [])[0];
  const accountId = (self && self.accountId) || data.mainAccountId;
  if (!accountId) throw new Error('RingCX token exchange returned no account id');

  cxSession = { token, accountId: String(accountId), fetchedAt: Date.now() };
  return cxSession;
}

async function cxGet(path) {
  const { token } = await getCxSession();
  const { data } = await axios.get(`${RINGCX_ADMIN_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 15000,
  });
  return data;
}

const asArray = (d) => (Array.isArray(d) ? d : (d && (d.items || d.data || d.records)) || []);

/**
 * Every RingCX agent across every agent group in the sub-account. Agents are
 * only addressable per-group, so this fans out over the group list.
 */
async function listAgents() {
  const { accountId } = await getCxSession();
  const groups = asArray(await cxGet(`/accounts/${accountId}/agentGroups`));

  const out = [];
  const seen = new Set();
  for (const g of groups) {
    const groupId = g.agentGroupId ?? g.id;
    if (groupId == null) continue;
    let agents;
    try {
      agents = asArray(await cxGet(`/accounts/${accountId}/agentGroups/${groupId}/agents`));
    } catch {
      continue; // one unreadable group must not sink the whole lookup
    }
    for (const a of agents) {
      if (a.agentId == null || seen.has(a.agentId)) continue;
      seen.add(a.agentId);
      out.push({
        agentId: a.agentId,
        firstName: a.firstName,
        lastName: a.lastName,
        username: a.username,
        rcUserId: a.rcUserId,
        agentType: a.agentType,
        isActive: a.isActive,
        agentGroupId: groupId,
        agentGroupName: g.agentGroupName || g.name || null,
      });
    }
  }
  return out;
}

/** The RingCX agent linked to a RingEX extension id, or null. */
async function findAgentByRcUserId(rcUserId) {
  if (rcUserId == null) return null;
  const wanted = String(rcUserId);
  const all = await listAgents();
  return all.find((a) => a.rcUserId != null && String(a.rcUserId) === wanted) || null;
}

module.exports = {
  hasCredentials,
  listExtensions,
  listAgents,
  findAgentByRcUserId,
};

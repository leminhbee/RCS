const { AlulaAPI } = require('@alula-net/alula-js');

// Alula Connect lookups, for resolving a staff member's alulaConnectId.
// Read-only: this module only ever fetches.
//
// Auth is the client-credentials grant. The refresh_token grant is not available
// for it, so renewal means asking for a new token with the same scopes — which
// is what the TTL below drives.

const SCOPES = ['rest', 'rpc'];
const TOKEN_TTL_MS = 30 * 60 * 1000;

let api = null;
let tokenFetchedAt = 0;

function hasCredentials() {
  return Boolean(
    process.env.PRODUCTION_BASE_URL &&
    process.env.PRODUCTION_CLIENT_ID &&
    process.env.PRODUCTION_CLIENT_SECRET
  );
}

async function getApi() {
  if (!api) {
    api = new AlulaAPI({
      clientId: process.env.PRODUCTION_CLIENT_ID,
      clientSecret: process.env.PRODUCTION_CLIENT_SECRET,
      baseUrl: process.env.PRODUCTION_BASE_URL,
    });
    tokenFetchedAt = 0;
  }
  if (Date.now() - tokenFetchedAt > TOKEN_TTL_MS) {
    try {
      await api.clientCredentials(SCOPES);
      tokenFetchedAt = Date.now();
    } catch (error) {
      // Drop the instance so a transient auth failure can't wedge the module
      // into permanently reusing a client with no usable token.
      api = null;
      tokenFetchedAt = 0;
      throw error;
    }
  }
  return api;
}

// Connect holds dealers, technicians, sub-users and a lot of test accounts
// alongside staff, and they frequently share a staff email address — searching
// one of our own addresses unfiltered returns a dozen rows of things like
// `MarcusDealerTest` and `flxtest`. Staff are the System role (UserRole.System
// = 2, UserType.System = 'system'), with usernames of the form admin.csc.*, and
// filtering to them turns a dozen ambiguous rows into exactly one.
const STAFF_USER_TYPE = 'system';

/**
 * Staff (System-role) users whose email matches exactly. Returns [] when nobody
 * matches; throws only on a real failure (auth, network), so the resolver can
 * tell "no such user" apart from "the lookup broke".
 * @param {string} email
 * @returns {Promise<Array<{id:string,email:string,nameFirst:string,nameLast:string,username:string,uType:any}>>}
 */
async function findUsersByEmail(email) {
  if (!email) return [];
  const client = await getApi();
  const collection = await client.users.fetchAll({
    filter: { email, userType: STAFF_USER_TYPE },
    page: { size: 10 },
  });
  return (collection.data || []).map((u) => ({
    id: u.id,
    email: u.email,
    nameFirst: u.nameFirst,
    nameLast: u.nameLast,
    username: u.username,
    uType: u.uType != null ? u.uType : u.userType,
  }));
}

module.exports = { hasCredentials, findUsersByEmail };

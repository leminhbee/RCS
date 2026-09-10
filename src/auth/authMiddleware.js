const atp = require('../ATP');
const { createLogger } = require('../helpers/logger');

const authLogger = createLogger('auth');

// How long a user's `active` state is trusted before we re-check it against ATP.
// req.session.user is a snapshot taken at login, so without this a deactivated
// user's open tab would keep working until the 8h session expired. The trade-off
// is that deactivation takes up to this long to boot an open tab.
const ACTIVE_RECHECK_MS = 60 * 1000;

const DEACTIVATED_MESSAGE = 'This account has been deactivated. Please contact your supervisor.';

// Cached per user id rather than on the session, for two reasons: static assets
// under /dashboard also pass through requireAuth, so one page load fans out into
// many near-simultaneous checks; and express-session doesn't persist until the
// response ends, so a session-stored timestamp would be stale for every request
// in that burst. `inFlight` collapses concurrent lookups for the same user into
// a single ATP call.
const activeCache = new Map(); // userId -> { checkedAt, active }
const inFlight = new Map(); // userId -> Promise<boolean>

// Called when a supervisor flips someone's active state so the change takes
// effect on the very next request instead of waiting out ACTIVE_RECHECK_MS.
function invalidateActiveCache(userId) {
  activeCache.delete(userId);
  inFlight.delete(userId);
}

// Resolves to true (allowed), false (deactivated or record gone), or null when
// ATP couldn't be reached and the caller should fail open.
async function isStillActive(userId) {
  const cached = activeCache.get(userId);
  if (cached && Date.now() - cached.checkedAt < ACTIVE_RECHECK_MS) return cached.active;

  if (inFlight.has(userId)) return inFlight.get(userId);

  const lookup = (async () => {
    try {
      const fresh = await atp.users.fetchOne(userId);
      // A missing row means the user was hard-deleted out from under the session.
      const active = !!fresh && fresh.active !== false;
      activeCache.set(userId, { checkedAt: Date.now(), active });
      return active;
    } catch (error) {
      authLogger.warn({ err: error.message, userId }, 'Active recheck failed — allowing request');
      return null;
    } finally {
      inFlight.delete(userId);
    }
  })();

  inFlight.set(userId, lookup);
  return lookup;
}

// If the request looks like an XHR/fetch to an API route, return a proper
// 401 JSON so the client can show a specific "session expired" message.
// Full page loads keep their 302 redirect to the login flow so the browser
// bounces the user through auth as expected.
function isApiRequest(req) {
  if (req.originalUrl && req.originalUrl.includes('/api/')) return true;
  const accept = String(req.headers.accept || '');
  const xrw = String(req.headers['x-requested-with'] || '').toLowerCase();
  if (xrw === 'xmlhttprequest') return true;
  if (accept.includes('application/json') && !accept.includes('text/html')) return true;
  return false;
}

async function requireAuth(req, res, next) {
  if (req.session?.user) {
    // Fails OPEN on a null result: if ATP is unreachable the request continues.
    // An ATP outage locking every supervisor out of the dashboard would be far
    // worse than a deactivated account lingering for the length of the outage.
    const active = await isStillActive(req.session.user.id);
    if (active !== false) return next();

    authLogger.info({ userId: req.session.user.id, url: req.originalUrl }, 'Destroying session for inactive user');
    const isApi = isApiRequest(req);
    return req.session.destroy(() => {
      if (isApi) return res.status(401).json({ error: DEACTIVATED_MESSAGE });
      res.redirect('/auth/login?error=inactive');
    });
  }

  if (isApiRequest(req)) {
    authLogger.warn({
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }, 'Unauthenticated API request rejected');
    return res.status(401).json({ error: 'Session expired. Please reload the page and sign in again.' });
  }

  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}

module.exports = requireAuth;
module.exports.invalidateActiveCache = invalidateActiveCache;

const { createLogger } = require('../helpers/logger');

const authLogger = createLogger('auth');

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

function requireAuth(req, res, next) {
  if (req.session?.user) return next();

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

const cca = require('../auth/msalConfig');
const atp = require('../ATP');

const REDIRECT_URI = `${process.env.APP_BASE_URL}/auth/callback`;
const SCOPES = ['openid', 'profile', 'email'];

async function login(req, res) {
  try {
    const authUrl = await cca.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
    });
    res.redirect(authUrl);
  } catch (err) {
    console.error('Error generating auth URL:', err);
    res.status(500).send('Authentication error. Please try again.');
  }
}

async function callback(req, res) {
  try {
    const tokenResponse = await cca.acquireTokenByCode({
      code: req.query.code,
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
    });

    const atpUser = await atp.users.fetchOne({ microsoftId: tokenResponse.account.localAccountId });

    req.session.user = {
      name: tokenResponse.account.name,
      email: tokenResponse.account.username,
      ...atpUser,
    };

    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (err) {
    console.error('Error acquiring token:', err);
    res.status(500).send('Authentication failed. Please try again.');
  }
}

function logout(req, res) {
  req.session.destroy(() => {
    const postLogoutUri = encodeURIComponent(`${process.env.APP_BASE_URL}/auth/login`);
    const logoutUrl = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${postLogoutUri}`;
    res.redirect(logoutUrl);
  });
}

module.exports = { login, callback, logout };

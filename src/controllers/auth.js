const path = require('path');
const cca = require('../auth/msalConfig');
const atp = require('../ATP');

const REDIRECT_URI = `${process.env.APP_BASE_URL}/auth/callback`;
const SCOPES = ['openid', 'profile', 'email', 'Calendars.Read'];

function login(_req, res) {
  res.sendFile(path.join(__dirname, '../../public/login.html'));
}

async function checkEmail(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const atpUser = await atp.users.fetchOne({ email });

    if (!atpUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (atpUser.ssoEnabled) {
      const authUrl = await cca.getAuthCodeUrl({
        scopes: SCOPES,
        redirectUri: REDIRECT_URI,
        loginHint: email,
      });
      return res.json({ sso: true, redirectUrl: authUrl });
    }

    return res.json({ sso: false });
  } catch (err) {
    console.error('Error in check-email:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function localLogin(req, res) {
  const { email, password } = req.body;

  try {
    const atpUser = await atp.users.authenticate(email, password);

    if (!atpUser) {
      return res.redirect('/auth/login?error=1');
    }

    if (atpUser.ssoEnabled) {
      return res.redirect('/auth/login?error=sso');
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.redirect('/auth/login?error=1');
      }

      const fullName = `${atpUser.nameFirst} ${atpUser.nameLast}`.trim();

      if (atpUser.passwordResetRequired) {
        req.session.pendingReset = { id: atpUser.id, email: atpUser.email, name: fullName };
        return res.redirect('/auth/reset-password');
      }

      req.session.user = { name: fullName, ...atpUser };

      const returnTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) {
    console.error('Error during local login:', err);
    res.redirect('/auth/login?error=1');
  }
}

function resetPasswordPage(req, res) {
  if (!req.session.pendingReset) {
    return res.redirect('/auth/login');
  }
  res.sendFile(path.join(__dirname, '../../public/reset-password.html'));
}

function changePasswordPage(req, res) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  const { id, email, name } = req.session.user;
  req.session.pendingReset = { id, email, name };
  res.sendFile(path.join(__dirname, '../../public/reset-password.html'));
}

async function resetPassword(req, res) {
  if (!req.session.pendingReset) {
    return res.redirect('/auth/login');
  }

  const { password, confirmPassword } = req.body;
  const { id, email, name } = req.session.pendingReset;

  const meetsRequirements = password &&
    password.length >= 6 &&
    password.length <= 64 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);

  if (!meetsRequirements) {
    return res.redirect('/auth/reset-password?error=requirements');
  }

  if (password !== confirmPassword) {
    return res.redirect('/auth/reset-password?error=mismatch');
  }

  try {
    await atp.users.update(id, { password, passwordResetRequired: false });
    const updatedUser = await atp.users.fetchOne(id);

    req.session.pendingReset = null;
    req.session.user = { name: `${updatedUser.nameFirst} ${updatedUser.nameLast}`.trim(), ...updatedUser };
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error resetting password:', err);
    res.redirect('/auth/reset-password?error=1');
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

    if (!atpUser || !atpUser.ssoEnabled) {
      return res.status(403).send('SSO is not enabled for this account.');
    }

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
  const ssoEnabled = req.session.user?.ssoEnabled;
  req.session.destroy(() => {
    if (ssoEnabled) {
      const postLogoutUri = encodeURIComponent(`${process.env.APP_BASE_URL}/auth/login`);
      const logoutUrl = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${postLogoutUri}`;
      res.redirect(logoutUrl);
    } else {
      res.redirect('/auth/login');
    }
  });
}

module.exports = { login, localLogin, checkEmail, resetPasswordPage, changePasswordPage, resetPassword, callback, logout };

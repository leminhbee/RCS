const session = require('express-session');
const FileStore = require('session-file-store')(session);

const sessionMiddleware = session({
  store: new FileStore({ path: './sessions', ttl: 8 * 60 * 60 }),
  secret: process.env.DASHBOARD_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
});

module.exports = sessionMiddleware;

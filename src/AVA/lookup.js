const ava = require('./client');

/**
 * Look up a Slack user by email via AVA, which owns the bot token.
 * @param {string} email
 * @returns {Promise<object|null>} The user, or null when Slack has nobody on
 *   that address — "not found" is an ordinary answer during onboarding, not an
 *   error, so it does not throw. Genuine failures (token, network) do throw so
 *   the resolver can report the field as errored rather than as empty.
 */
const slackUserByEmail = async (email) => {
  try {
    const { data } = await ava.get('/lookup/slack-user', {
      params: { email },
      timeout: 10000,
    });
    return data;
  } catch (error) {
    // Only Slack's own "no such user" is a null result. A bare 404 from Express
    // (route not mounted, AVA not redeployed) must surface as an error, or a
    // deploy mistake would quietly render as "this person has no Slack account".
    const body = error.response && error.response.data;
    if (error.response && error.response.status === 404 && body && body.error === 'users_not_found') {
      return null;
    }
    throw new Error('Error looking up Slack user via AVA: ' + error.message);
  }
};

module.exports = { slackUserByEmail };

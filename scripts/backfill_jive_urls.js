require('dotenv').config();

const atp = require('../src/ATP');
const { sfdcConn } = require('../src/config/sfdc');
const { createScriptLogger } = require('../src/helpers/scriptLogger');

const logger = createScriptLogger();

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    since: get('since'),
    until: get('until'),
    dryRun: args.includes('--dry-run'),
  };
}

function startOfTodayCentral() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  const localMidnight = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  const ctNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const ctOffset = now.getTime() - ctNow.getTime();
  return new Date(localMidnight.getTime() + ctOffset);
}

async function main() {
  const { since: sinceArg, until: untilArg, dryRun } = parseArgs();

  const since = sinceArg ? new Date(sinceArg) : startOfTodayCentral();
  const until = untilArg ? new Date(untilArg) : new Date();

  const startMsg = `Backfilling Jive_URL__c for calls between ${since.toISOString()} and ${until.toISOString()}${dryRun ? ' (DRY RUN)' : ''}`;
  console.log(startMsg);
  logger.info({ operation: 'start', since, until, dryRun }, startMsg);

  console.log('Fetching ATP calls...');
  const fetchStart = Date.now();
  const calls = await atp.calls.fetchAll({
    startTime: { $gte: since.toISOString(), $lte: until.toISOString() },
  });
  const fetchSeconds = (Date.now() - fetchStart) / 1000;
  console.log(`  fetched ${calls.length} calls in ${fetchSeconds.toFixed(1)}s`);
  logger.info({ operation: 'fetched', count: calls.length, durationSeconds: fetchSeconds }, 'ATP calls fetched');

  const eligible = calls.filter(c => c.salesforceCaseId && c.callLink);
  console.log(`${eligible.length} eligible for backfill (have salesforceCaseId + callLink).`);

  if (eligible.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const byCase = new Map();
  for (const call of eligible) {
    const list = byCase.get(call.salesforceCaseId) ?? [];
    list.push(call);
    byCase.set(call.salesforceCaseId, list);
  }

  console.log(`Grouped into ${byCase.size} unique case(s). Authorizing Salesforce...`);
  await sfdcConn.authorize({ grant_type: 'client_credentials' });

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let processed = 0;
  const totalCases = byCase.size;

  for (const [caseId, callsForCase] of byCase) {
    processed++;
    process.stdout.write(`[${processed}/${totalCases}] ${caseId}: `);
    try {
      const existing = await sfdcConn.sobject('Case').retrieve(caseId, ['Jive_URL__c']);
      const existingUrl = existing.Jive_URL__c || '';
      const existingLines = new Set(existingUrl.split('\n').filter(Boolean));

      const newUrls = callsForCase
        .map(c => c.callLink)
        .filter(u => !existingLines.has(u));

      if (newUrls.length === 0) {
        console.log(`already has all ${callsForCase.length} URL(s), skipping`);
        logger.info({ operation: 'case', result: 'unchanged', caseId, callCount: callsForCase.length }, 'Case already has all URLs');
        unchanged++;
        continue;
      }

      const merged = existingUrl
        ? `${existingUrl}\n${newUrls.join('\n')}`
        : newUrls.join('\n');

      if (dryRun) {
        console.log(`would append ${newUrls.length} URL(s)`);
        logger.info({ operation: 'case', result: 'would_update', caseId, urls: newUrls }, 'Dry-run: would append URLs');
      } else {
        await sfdcConn.sobject('Case').update({ Id: caseId, Jive_URL__c: merged });
        console.log(`appended ${newUrls.length} URL(s)`);
        logger.info({ operation: 'case', result: 'updated', caseId, urls: newUrls }, 'Appended URLs to case');
      }
      updated++;
    } catch (err) {
      console.error(`failed — ${err.message}`);
      logger.error({ operation: 'case', result: 'failed', caseId, error: { message: err.message, stack: err.stack } }, 'Failed to update case');
      failed++;
    }
  }

  const summary = `Done. Updated: ${updated}, Unchanged: ${unchanged}, Failed: ${failed}`;
  console.log(`\n${summary}`);
  logger.info({ operation: 'done', updated, unchanged, failed }, summary);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  logger.error({ operation: 'fatal', error: { message: err.message, stack: err.stack } }, 'Fatal error');
  process.exit(1);
});

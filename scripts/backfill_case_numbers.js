require('dotenv').config();

const atp = require('../src/ATP');
const { sfdcConn } = require('../src/config/sfdc');

async function main() {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  console.log(`Fetching calls since ${twoWeeksAgo.toISOString()}...`);

  const calls = await atp.calls.fetchAll({ startTimeAfter: twoWeeksAgo.toISOString() });
  const toUpdate = calls.filter(c => c.salesforceCaseId && !c.salesforceCaseNumber);

  console.log(`Found ${calls.length} total calls, ${toUpdate.length} need case number backfill.`);

  if (toUpdate.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  await sfdcConn.authorize({ grant_type: 'client_credentials' });

  // Deduplicate case IDs so we only query each case once
  const uniqueCaseIds = [...new Set(toUpdate.map(c => c.salesforceCaseId))];
  console.log(`Querying ${uniqueCaseIds.length} unique Salesforce cases...`);

  const caseNumberMap = {};
  for (const caseId of uniqueCaseIds) {
    try {
      const caseRecord = await sfdcConn.sobject('Case').retrieve(caseId, ['CaseNumber']);
      caseNumberMap[caseId] = caseRecord.CaseNumber;
    } catch (err) {
      console.warn(`  Could not retrieve case ${caseId}: ${err.message}`);
    }
  }

  let updated = 0;
  let failed = 0;

  for (const call of toUpdate) {
    const caseNumber = caseNumberMap[call.salesforceCaseId];
    if (!caseNumber) {
      console.warn(`  Skipping call ${call.id} — no case number found for ${call.salesforceCaseId}`);
      failed++;
      continue;
    }
    try {
      await atp.calls.update(call.id, { salesforceCaseNumber: caseNumber });
      console.log(`  Updated call ${call.id} → ${caseNumber}`);
      updated++;
    } catch (err) {
      console.error(`  Failed to update call ${call.id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped/Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

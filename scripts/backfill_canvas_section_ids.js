// One-off backfill: for each tracked_issues row that has no canvas_section_id,
// walk the current Slack canvas HTML, group section ids by issue block, and
// populate the row with its block's section ids. After running, Delete on
// backfilled rows will also remove the block from the canvas.
//
// Usage:
//   node scripts/backfill_canvas_section_ids.js --dry-run
//   node scripts/backfill_canvas_section_ids.js --commit

require('dotenv').config();

const axios = require('axios');
const atp = require('../src/ATP');
const { createScriptLogger } = require('../src/helpers/scriptLogger');

const logger = createScriptLogger();

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: !args.includes('--commit'),
    verbose: args.includes('--verbose'),
  };
}

async function fetchCanvasHtml() {
  const { data } = await axios.get(`${process.env.AVA_URL}/tracked-issues/canvas-content`);
  if (!data || !data.ok) throw new Error(`AVA canvas-content: ${data && data.error}`);
  return data.html || '';
}

// Normalize a canvas h2 summary "⚠️ Issue Summary: Z-wave devices not showing."
// into a comparable form matching what's in the DB row summary field.
function normalizeSummary(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')                       // strip any nested HTML
    .replace(/[⚠️️]/g, '')                          // strip warning emoji + variation selector
    .replace(/^\s*Issue\s+Summary\s*:\s*/i, '')     // strip label
    .replace(/[.!?\s]+$/, '')                       // strip trailing punctuation/space
    .trim()
    .toLowerCase();
}

// Split the canvas HTML on h2 boundaries. Return one entry per h2 that looks
// like an issue-summary heading, plus everything after it until the next h2.
// Walks the block's HTML in document order and builds field->sectionId map
// for the labeled fields, plus the flat list of all section ids in the block.
function parseBlockFields(headerId, bodyHtml) {
  const ELEM_RE = /<(h[1-6]|p|div|ul|ol|table)[^>]*\bid=(?:"|')([^"']+)(?:"|')[^>]*>([\s\S]*?)<\/\1>/g;
  const fields = { summary: headerId };
  let pendingBody = null;
  let m;
  while ((m = ELEM_RE.exec(bodyHtml)) !== null) {
    const [, tag, id, inner] = m;
    const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (/^Incident Date:/i.test(text)) { fields.incidentDate = id; pendingBody = null; continue; }
    if (/^Severity level:/i.test(text)) { fields.severity = id; pendingBody = null; continue; }
    if (/^Status:/i.test(text)) { fields.status = id; pendingBody = null; continue; }
    if (/^Description of Issue\.?/i.test(text)) { pendingBody = 'description'; fields.descriptionHeading = id; continue; }
    if (/^Required Information from the Dealer\.?/i.test(text)) { pendingBody = 'dealerInfo'; fields.dealerInfoHeading = id; continue; }
    if (/^What to look for\?/i.test(text)) { pendingBody = 'whatToLookFor'; fields.whatToLookForHeading = id; continue; }
    if (pendingBody && text) { fields[pendingBody] = id; pendingBody = null; }
  }
  return fields;
}

function parseBlocks(html) {
  const H2_RE = /<h2[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g;
  const positions = [];
  let m;
  while ((m = H2_RE.exec(html)) !== null) {
    positions.push({ id: m[1], rawTitle: m[2], start: m.index, end: m.index + m[0].length });
  }
  const blocks = [];
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const next = positions[i + 1];
    const raw = cur.rawTitle;
    const title = raw.replace(/<[^>]+>/g, '').trim();
    if (!/Issue\s+Summary\s*:/i.test(title)) continue;
    const bodyEnd = next ? next.start : html.length;
    const bodyHtml = html.substring(cur.end, bodyEnd);
    // Flat list of section ids for delete purposes.
    const ids = [cur.id];
    const idRe = /\bid=(?:"|')([^"']+)(?:"|')/g;
    let idM;
    while ((idM = idRe.exec(bodyHtml)) !== null) ids.push(idM[1]);
    const seen = new Set();
    const all = ids.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
    // Field-labeled mapping for edit-in-place.
    const fields = parseBlockFields(cur.id, bodyHtml);
    blocks.push({
      summary: normalizeSummary(title),
      rawTitle: title,
      all,
      fields,
    });
  }
  return blocks;
}

async function main() {
  const { dryRun, verbose } = parseArgs();
  console.log(`Backfilling canvas_section_id from Slack canvas${dryRun ? ' (DRY RUN)' : ''}...`);
  logger.info({ operation: 'start', dryRun }, 'Backfill starting');

  const html = await fetchCanvasHtml();
  console.log(`Fetched ${html.length} chars of canvas HTML.`);

  const blocks = parseBlocks(html);
  console.log(`Parsed ${blocks.length} issue block(s) from the canvas.`);

  const rows = (await atp.trackedIssues.fetchAll({})) || [];
  const byNorm = new Map();
  for (const row of rows) {
    // Skip rows that already have a mapping with either shape populated.
    const c = row.canvasSectionId;
    if (c && Array.isArray(c) && c.length) continue;
    if (c && typeof c === 'object' && !Array.isArray(c) && ((Array.isArray(c.all) && c.all.length) || (c.fields && Object.keys(c.fields).length))) continue;
    const key = normalizeSummary(row.summary);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(row);
  }
  const eligibleCount = Array.from(byNorm.values()).reduce((n, arr) => n + arr.length, 0);
  console.log(`DB rows without canvas_section_id: ${eligibleCount}`);

  const results = { blocks: blocks.length, matched: 0, ambiguous: 0, notInDb: 0, updated: 0, failed: 0 };

  for (const block of blocks) {
    const candidates = byNorm.get(block.summary) || [];
    if (!candidates.length) {
      results.notInDb++;
      if (verbose) console.log(`  no DB row: "${block.rawTitle}"`);
      continue;
    }
    if (candidates.length > 1) {
      results.ambiguous++;
      console.log(`  AMBIGUOUS (${candidates.length} DB rows match): "${block.rawTitle}"`);
      continue;
    }
    const row = candidates[0];
    results.matched++;
    const fieldKeys = Object.keys(block.fields);
    console.log(`  match: "${block.rawTitle}" -> row ${row.id} (${block.all.length} sections, ${fieldKeys.length} field mappings)`);
    if (verbose) {
      console.log(`    fields: ${fieldKeys.join(', ')}`);
      console.log(`    all: ${block.all.join(', ')}`);
    }
    if (dryRun) continue;
    try {
      await atp.trackedIssues.update(row.id, { canvasSectionId: { all: block.all, fields: block.fields } });
      results.updated++;
    } catch (err) {
      results.failed++;
      logger.error({ err: err.message, rowId: row.id }, 'PATCH failed');
      console.log(`    FAIL: ${err.message}`);
    }
  }

  console.log(`\nDone. ${JSON.stringify(results, null, 2)}`);
  logger.info({ operation: 'done', ...results, dryRun }, 'Backfill complete');
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  logger.error({ err: err.message, stack: err.stack }, 'Backfill fatal');
  process.exit(1);
});

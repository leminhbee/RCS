// One-off backfill: parse the existing "Current Issues" Slack canvas and
// insert each entry into the ATP tracked_issues table.
//
// Usage:
//   node scripts/backfill_tracked_issues.js --dry-run   # parse and print
//   node scripts/backfill_tracked_issues.js --commit    # actually POST
//
// Idempotent — skips issues whose summary already exists in ATP.
//
// All inserted rows default to active=false so the ticker starts empty;
// supervisors can flip individual ones to active=true after review.

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

async function fetchCanvasMarkdown() {
  const url = `${process.env.AVA_URL}/tracked-issues/canvas-content`;
  const { data } = await axios.get(url);
  if (!data || !data.ok) {
    throw new Error(`AVA canvas-content returned not-ok: ${data && data.error}`);
  }
  // AVA returns HTML for canvas bodies. Convert to a line-oriented plain-text
  // form that our label-based parser understands. Preserve newlines at every
  // block-level boundary and strip inline tags/entities.
  const html = data.html || data.markdown || '';
  return htmlToPlain(html);
}

function htmlToPlain(html) {
  if (!html) return '';
  // Insert newlines at block-level boundaries so headings and paragraphs stay on their own lines.
  const withBreaks = html
    .replace(/<\/(?:p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  // Drop everything else that's an HTML tag.
  const noTags = withBreaks.replace(/<[^>]+>/g, '');
  // Decode common HTML entities.
  const decoded = noTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  return decoded;
}

// Split canvas markdown into per-issue blocks. The canvas format (per the
// screenshot in the tracking doc) starts each entry with:
//   :warning: Issue Summary: <summary>       (or a ⚠️ emoji, or "**Issue Summary:**")
// Blocks are separated by blank lines or horizontal rules.
function splitIssueBlocks(markdown) {
  if (!markdown) return [];
  // Normalize a few emoji forms to a single anchor "ISSUE_SUMMARY_LINE::"
  const norm = markdown
    .replace(/[⚠️]/g, '')                 // strip warning emoji + variation selectors
    .replace(/:warning:/gi, '')
    .replace(/^\s*#+\s*/gm, '')                     // strip leading heading hashes
    .replace(/\*\*/g, '');                          // strip bold markers

  const lines = norm.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^\s*Issue Summary\s*:\s*(.*)$/i);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { summary: m[1].trim().replace(/[.!?]*$/, '').slice(0, 200), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

// Extract labeled fields from an issue block body. Multi-line values run to
// the next known label OR blank-line-then-label.
const LABELS = [
  { key: 'incidentDate',   pattern: /^Incident Date\s*:\s*(.*)$/i },
  { key: 'severity',       pattern: /^Severity(?:\s+level)?\s*:\s*(.*)$/i },
  { key: 'status',         pattern: /^Status\s*:\s*(.*)$/i },
  { key: 'description',    pattern: /^Description\s+of\s+Issue\.?\s*(.*)$/i },
  { key: 'dealerInfo',     pattern: /^Required\s+Information\s+from\s+the\s+Dealer\.?\s*(.*)$/i },
  { key: 'whatToLookFor',  pattern: /^What\s+to\s+look\s+for\??\s*(?:\(.*\))?\s*(.*)$/i },
];

function parseFields(bodyLines) {
  const out = {};
  let currentKey = null;
  let buf = [];
  const flush = () => {
    if (currentKey && buf.length) {
      const val = buf.join('\n').trim();
      if (val) out[currentKey] = val;
    }
    buf = [];
  };
  for (const line of bodyLines) {
    let matched = null;
    for (const { key, pattern } of LABELS) {
      const m = line.match(pattern);
      if (m) { matched = { key, first: m[1] }; break; }
    }
    if (matched) {
      flush();
      currentKey = matched.key;
      if (matched.first) buf.push(matched.first);
    } else if (currentKey) {
      buf.push(line);
    }
  }
  flush();

  // Coerce severity to integer if it's a digit.
  if (out.severity != null) {
    const n = parseInt(String(out.severity).match(/\d+/)?.[0] || '', 10);
    out.severity = Number.isFinite(n) ? n : null;
    if (out.severity == null) delete out.severity;
  }
  // Coerce incidentDate to YYYY-MM-DD if parseable, else drop.
  if (out.incidentDate) {
    const d = new Date(out.incidentDate);
    if (Number.isFinite(d.getTime())) {
      out.incidentDate = d.toISOString().slice(0, 10);
    } else {
      delete out.incidentDate;
    }
  }
  return out;
}

async function main() {
  const { dryRun, verbose } = parseArgs();
  console.log(`Backfilling tracked issues from Slack canvas${dryRun ? ' (DRY RUN)' : ''}...`);
  logger.info({ operation: 'start', dryRun }, 'Backfill starting');

  const markdown = await fetchCanvasMarkdown();
  console.log(`Fetched ${markdown.length} chars of canvas markdown.`);
  logger.info({ operation: 'fetched', chars: markdown.length }, 'Canvas fetched');

  const blocks = splitIssueBlocks(markdown);
  console.log(`Parsed ${blocks.length} issue block(s).`);

  const existing = await atp.trackedIssues.fetchAll({});
  const existingSummaries = new Set((existing || []).map((i) => i.summary));
  console.log(`Existing tracked_issues in DB: ${existingSummaries.size}`);

  const results = { parsed: blocks.length, skippedNoSummary: 0, skippedDup: 0, inserted: 0, failed: 0 };

  for (const block of blocks) {
    if (!block.summary) { results.skippedNoSummary++; continue; }
    if (existingSummaries.has(block.summary)) {
      results.skippedDup++;
      if (verbose) console.log(`  skip dup: ${block.summary}`);
      continue;
    }
    const fields = parseFields(block.body);
    const payload = {
      summary: block.summary,
      active: false, // backfilled rows start hidden from the ticker
      ...fields,
    };
    if (verbose || dryRun) {
      console.log(`\n--- ${payload.summary} ---`);
      for (const [k, v] of Object.entries(payload)) {
        if (k === 'summary') continue;
        const shown = typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : v;
        console.log(`  ${k}: ${JSON.stringify(shown)}`);
      }
    }
    if (dryRun) { results.inserted++; continue; }
    try {
      await atp.trackedIssues.create(payload);
      results.inserted++;
    } catch (err) {
      results.failed++;
      logger.error({ err: err.message, summary: payload.summary }, 'Insert failed');
      console.log(`  FAIL: ${payload.summary} — ${err.message}`);
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

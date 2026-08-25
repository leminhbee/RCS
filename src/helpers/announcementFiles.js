const fs = require('fs/promises');
const path = require('path');
const { validate: isUUID } = require('uuid');

// Attachments live outside public/ so the static middleware can never serve
// them; the only way in is the authenticated download route on the dashboard
// router.
const ROOT = path.join(__dirname, '../../UPLOADS/announcements');

const MB = 1024 * 1024;
// Matches the compose form's client-side ceiling. Base64 inflates the request
// body by ~33%, so this sits just under the 32MB express.json limit.
const MAX_TOTAL_BYTES = 24 * MB;

// Same validator the ATP client uses, so an id this accepts is one the API
// will also accept — otherwise a hex-shaped but invalid id passes the path
// check here and then throws downstream, turning a 404 into a 500.
function isValidId(id) {
  return typeof id === 'string' && isUUID(id);
}

// Strip anything that could escape the announcement's directory, and keep the
// name inside ext4's 255-byte limit once the index prefix is added.
function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[\/\\\0]/g, '');
  const cleaned = base.replace(/^\.+/, '').trim() || 'file';
  return cleaned.length > 120 ? cleaned.slice(-120) : cleaned;
}

function dirFor(announcementId) {
  if (!isValidId(String(announcementId))) return null;
  return path.join(ROOT, String(announcementId));
}

// Writes the decoded uploads to disk and returns the metadata to persist on the
// announcement row. Array position IS the download URL's :idx, so callers must
// preserve the returned order.
async function save(announcementId, files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return [];
  const dir = dirFor(announcementId);
  if (!dir) throw new Error('Invalid announcement id');
  await fs.mkdir(dir, { recursive: true });
  const saved = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i] || {};
    const buf = Buffer.from(String(f.base64 || ''), 'base64');
    const name = safeName(f.name);
    // Index prefix so two attachments sharing a filename don't collide.
    const stored = `${i}-${name}`;
    await fs.writeFile(path.join(dir, stored), buf);
    saved.push({
      name,
      mimeType: typeof f.mimeType === 'string' && f.mimeType ? f.mimeType : 'application/octet-stream',
      size: buf.length,
      stored,
    });
  }
  return saved;
}

// Resolves :idx back to a file on disk using the metadata already stored on the
// row. Returns null for anything unrecognised so the caller can 404 without
// revealing whether the directory exists.
function resolve(announcementId, idx, meta) {
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0) return null;
  const entry = Array.isArray(meta) ? meta[i] : null;
  // Legacy rows hold bare Slack permalink strings, which we never stored.
  if (!entry || typeof entry !== 'object' || !entry.stored) return null;
  const dir = dirFor(announcementId);
  if (!dir) return null;
  const full = path.join(dir, path.basename(String(entry.stored)));
  if (full !== path.join(dir, path.basename(full))) return null;
  return {
    path: full,
    name: entry.name || 'file',
    mimeType: entry.mimeType || 'application/octet-stream',
  };
}

// Best-effort removal of an announcement's whole attachment directory. Nothing
// calls this on the soft delete the dashboard performs — it exists for a hard
// delete or a cleanup script.
async function remove(announcementId) {
  const dir = dirFor(announcementId);
  if (!dir) return;
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

module.exports = { save, resolve, remove, isValidId, MAX_TOTAL_BYTES, ROOT };

"use strict";
// Shared validation for vendor-supplied release URLs (update feed, website). Used at run time by the desktop shell
// (config.cjs) and at build time by scripts/release-guard.mjs, so both agree on what a real URL looks like.

/** Hosts/markers that mean "not a real production address". */
const PLACEHOLDER = /(\.invalid$|\.example$|(^|\.)example\.(com|org|net)$|\.test$|\.localhost$|^localhost$|\.local$|^__SET|changeme|your-domain|yourdomain|<|>)/i;

/**
 * Returns null when `url` is acceptable, otherwise a short English reason.
 * release=true  → production rules: https only, a public-looking host, no placeholder, no local address.
 * release=false → development rules: additionally allows http://localhost / 127.0.0.1 for a local test feed.
 */
function urlProblem(url, { release = true } = {}) {
  const raw = String(url ?? "").trim();
  if (!raw) return "is empty";
  if (/^__SET/i.test(raw)) return "is still the release placeholder";
  let u;
  try {
    u = new URL(raw);
  } catch {
    return "is not a valid URL";
  }
  const host = u.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (u.username || u.password) return "must not contain credentials";
  if (u.protocol === "http:" && !release && local) return null;
  if (u.protocol !== "https:") return "must use https://";
  if (PLACEHOLDER.test(host)) return `uses a placeholder/reserved host (${host})`;
  if (!host.includes(".") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return `must be a public domain name (${host})`;
  return null;
}

module.exports = { urlProblem, PLACEHOLDER };

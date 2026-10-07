"use strict";
/* eslint-disable no-control-regex -- rejecting control characters is the purpose of these patterns */
// Strict argument validation for every IPC channel. Pure functions so they can be unit-tested without Electron.
const MAX_PDF = 25 * 1024 * 1024;
const MAX_FILE = 100 * 1024 * 1024;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const toBuf = (b) => {
  if (b instanceof ArrayBuffer) return Buffer.from(b);
  if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  throw new Error("Invalid data");
};

function sameOrigin(url, base) {
  try {
    return !!base && new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}
function safeRoute(route) {
  return typeof route === "string" && route.startsWith("/") && !route.startsWith("//") && !route.includes("\\") && !/[\u0000-\u001f]/.test(route) && route.length < 300 ? route : "/";
}
function bounds(b) {
  if (!isObj(b)) return undefined;
  const o = {};
  for (const k of ["x", "y", "width", "height"]) if (finite(b[k]) && Math.abs(b[k]) < 100000) o[k] = Math.round(b[k]);
  return o;
}
function pdfBytes(buf) {
  const data = toBuf(buf);
  if (data.length < 5 || data.length > MAX_PDF || data.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Not a PDF");
  return data;
}
function printArgs(buf, opts) {
  const data = pdfBytes(buf);
  const o = isObj(opts) ? opts : {};
  const printer = typeof o.printer === "string" && o.printer.length <= 256 && !/[\u0000-\u001f]/.test(o.printer) ? o.printer : undefined;
  return { data, silent: o.silent === true, printer, thermal: o.thermal === true };
}
function fileName(name) {
  const s = String(typeof name === "string" ? name : "file").replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").replace(/^\.+/, "").slice(0, 120);
  const base = s || "file";
  // Windows reserved device names
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base) ? "_" + base : base;
}
function saveArgs(name, data) {
  const buf = toBuf(data);
  if (buf.length > MAX_FILE) throw new Error("File too large");
  return { name: fileName(name), data: buf };
}
function windowOpts(opts) {
  const o = isObj(opts) ? opts : {};
  return { bounds: bounds(o.bounds), displayId: finite(o.displayId) ? o.displayId : undefined, title: typeof o.title === "string" ? o.title.slice(0, 80) : undefined };
}
function workspace(list) {
  if (!Array.isArray(list) || list.length > 8) throw new Error("Invalid workspace");
  return list.filter(isObj).map((w) => ({ route: safeRoute(w.route), displayId: finite(w.displayId) ? w.displayId : undefined, bounds: bounds(w.bounds) || {} }));
}
function serverUrl(input) {
  const u = new URL(String(input));
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error("bad url");
  return u.origin;
}
function externalUrl(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
module.exports = { pdfBytes, sameOrigin, safeRoute, bounds, printArgs, saveArgs, fileName, windowOpts, workspace, serverUrl, externalUrl, MAX_PDF };

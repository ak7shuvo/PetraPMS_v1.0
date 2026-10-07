"use strict";
// Exposes a minimal, validated bridge as window.petra. No Node APIs, no arbitrary IPC channels.
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const cfg = ipcRenderer.sendSync("petra:boot");

contextBridge.exposeInMainWorld("petra", {
  isDesktop: true,
  terminalId: cfg.terminalId,
  mode: cfg.mode,
  /** Receives the PDF as bytes (blob: URLs are not shareable across processes). */
  print: async (pdfUrl, opts = {}) => {
    try {
      const buf = await (await fetch(pdfUrl)).arrayBuffer();
      return await invoke("petra:print", buf, { silent: !!opts.silent, printer: typeof opts.printer === "string" ? opts.printer : undefined, thermal: !!opts.thermal });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  },
  previewPdf: async (pdfUrl, title) => invoke("petra:previewPdf", await (await fetch(pdfUrl)).arrayBuffer(), typeof title === "string" ? title : ""),
  openPdfExternal: async (pdfUrl) => invoke("petra:openPdfExternal", await (await fetch(pdfUrl)).arrayBuffer()),
  printers: () => invoke("petra:printers"),
  openWindow: (route, opts) => invoke("petra:openWindow", route, opts || {}),
  displays: () => invoke("petra:displays"),
  windowState: () => invoke("petra:windowState"),
  openWorkspace: (windows) => invoke("petra:openWorkspace", windows),
  saveFile: (name, data) => invoke("petra:saveFile", name, data),
  openDataFolder: () => invoke("petra:openDataFolder"),
  setKiosk: (on) => invoke("petra:setKiosk", !!on),
  appInfo: () => invoke("petra:appInfo"),
  checkForUpdates: () => invoke("petra:checkForUpdates"),
  updateStatus: () => invoke("petra:updateStatus"),
  installUpdate: () => invoke("petra:installUpdate"),
});

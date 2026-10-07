"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("welcome", {
  choose: (mode, serverUrl) => ipcRenderer.invoke("welcome:choose", { mode, serverUrl }),
  lanUrls: () => ipcRenderer.invoke("welcome:lan"),
});

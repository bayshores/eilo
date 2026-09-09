"use strict";

(() => {
  const ALLOWED_HOSTS = new Set(["leetcode.com", "neetcode.io", "docs.python.org"]);
  const PAGE_ORIGIN = "http://127.0.0.1:8765";
  const PORT_NAME = "eilo-metadata-v1";

  function title(value) {
    return typeof value === "string"
      ? value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)
      : "";
  }
  function approvedOrigin(rawUrl) {
    if (typeof rawUrl !== "string") return null;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || (url.port && url.port !== "443")) return null;
      return `https://${url.hostname.toLowerCase()}`;
    } catch { return null; }
  }
  function observationForTab(tab) {
    const origin = approvedOrigin(tab && tab.url);
    const safeTitle = title(tab && tab.title);
    return origin && safeTitle ? { kind: "approved_study_context", origin, title: safeTitle } : { kind: "activity_unshared" };
  }
  function senderIsEiloPage(sender) {
    // frameId is present for normal extension page ports. If a Chrome build omits
    // it for this external-port API, retain origin enforcement instead of guessing.
    if (!sender || typeof sender.url !== "string" || (typeof sender.frameId === "number" && sender.frameId !== 0)) return false;
    try { return new URL(sender.url).origin === PAGE_ORIGIN; } catch { return false; }
  }
  function validRequest(message, now = Date.now()) {
    if (!message || typeof message !== "object" || Object.keys(message).length !== 4 || message.type !== "snapshot") return false;
    if (typeof message.nonce !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(message.nonce)) return false;
    if (typeof message.client_id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(message.client_id)) return false;
    return Number.isInteger(message.expires_at) && message.expires_at >= now && message.expires_at <= now + 9000;
  }
  function equivalentTab(first, second) {
    return first && second && first.id === second.id && first.windowId === second.windowId && first.url === second.url && first.title === second.title;
  }
  globalThis.EiloActivityExtensionCore = { ALLOWED_HOSTS, PAGE_ORIGIN, PORT_NAME, approvedOrigin, observationForTab, senderIsEiloPage, validRequest, equivalentTab };
})();

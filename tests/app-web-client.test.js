"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  return { children: [], dataset: {}, value: "", disabled: false, textContent: "", className: "",
    addEventListener(type, fn) { this.listeners ||= {}; this.listeners[type] = fn; }, append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; }, setAttribute() {}, focus() {}, requestSubmit() { this.listeners.submit({ preventDefault() {} }); } };
}
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, headers: { get: () => "application/json" }, json: async () => body }; }
function textOf(node) { return `${node.textContent || ""}${node.children.map(textOf).join("")}`; }
const ready = { status: "ready", can_send: true, messages: [], error: null, conversation_id: "c", model: "gpt-5.6-luna", request_id: null, pending_message: null, accepted_request_ids: [], revision: "boot:1", accountability: { goal: { text: "", status: "none", version: 0 }, activity: { state: "off", reason: null, allowed_hosts: ["leetcode.com"], chrome_available: false, helper_available: true, consent_owner: false, preview: null, lease_client_id: null, sample_request: null }, deciding: true } };
const accepted = { ...ready, status: "busy", can_send: false, pending_message: { request_id: "request-1", text: "remember this", status: "accepted" }, accepted_request_ids: ["request-1"], revision: "boot:2" };
const completed = { ...ready, messages: [{ id: "hermes-user-9", role: "user", text: "remember this" }, { id: "hermes-assistant-3", role: "assistant", text: "I will." }], accepted_request_ids: ["request-1"], revision: "boot:3" };

function boot(fetchImpl) {
  const nodes = Object.fromEntries(["#composer", "#message-input", "#send-message", "#new-conversation", "#messages", "#empty-state", "#connection-status", "#form-status", ".conversation", "#goal-summary", "#goal-form", "#goal-input", "#goal-break", "#goal-resume", "#goal-cancel", "#accountability-status", "#activity-reason", "#activity-scope", "#activity-preview", "#activity-enable", "#activity-pause", "#activity-off"].map((key) => [key, element()]));
  const root = element();
  const timers = [], entries = [];
  const performance = { timeOrigin: 1000, mark: (name) => entries.push({ name, startTime: entries.length }), clearMarks: (name) => { for (let i = entries.length - 1; i >= 0; i--) if (!name || entries[i].name === name) entries.splice(i, 1); }, getEntriesByType: () => entries };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/web/app.js"), "utf8"), {
    AbortController, Promise, URLSearchParams, console, document: { querySelector: (key) => nodes[key], createElement: element, documentElement: root },
    window: { crypto: { randomUUID: () => "request-1" }, performance, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {} }, fetch: fetchImpl,
  });
  return { nodes, root, timers, entries };
}
const tick = () => new Promise(setImmediate);

(async () => {
  let stateCalls = 0, postCalls = 0, resolvePost;
  const main = boot((url) => {
    if (url === "/api/message") { postCalls++; return new Promise((resolve) => { resolvePost = resolve; }); }
    if (url.startsWith("/api/state")) return Promise.resolve(response(stateCalls++ ? completed : ready));
    throw new Error(`Unexpected request: ${url}`);
  });
  await tick();
  assert.equal(main.nodes["#activity-enable"].disabled, false, "first opt-in remains available while activity is off");
  assert.equal(main.nodes["#message-input"].disabled, false, "background deciding does not block a human turn");
  assert.equal(main.nodes["#activity-preview"].textContent, "Activity unshared");
  main.nodes["#message-input"].value = "remember this";
  main.nodes["#composer"].listeners.submit({ preventDefault() {} });
  assert.match(textOf(main.nodes["#messages"]), /remember thisSending/);
  const timing = JSON.parse(main.root.dataset.eiloTiming);
  assert.equal(typeof timing.timeOrigin, "number");
  assert.equal(JSON.stringify(timing).includes("remember this"), false, "timing data has no message content");
  main.nodes["#message-input"].value = "edited draft";
  resolvePost(response(accepted, 202));
  await tick();
  assert.equal(main.nodes["#message-input"].value, "edited draft", "editing during send keeps the changed draft");
  assert.match(textOf(main.nodes["#messages"]), /remember thisAccepted/);
  main.timers.pop()(); await tick();
  assert.equal((textOf(main.nodes["#messages"]).match(/remember this/g) || []).length, 1, "native Hermes IDs do not duplicate the request bubble");
  assert.ok(main.entries.some((entry) => entry.name === "eilo-native-transcript-dom"));
  assert.equal(postCalls, 1);

  let reloadCalls = 0;
  const reload = boot((url) => Promise.resolve(response(reloadCalls++ ? completed : accepted)));
  await tick();
  assert.match(textOf(reload.nodes["#messages"]), /remember thisAccepted/, "reload seeds from server pending state");
  assert.equal(reloadCalls, 1, "reload performs no POST");
  reload.timers.pop()(); await tick();
  assert.equal((textOf(reload.nodes["#messages"]).match(/remember this/g) || []).length, 1);
  assert.ok(reload.entries.some((entry) => entry.name === "eilo-native-transcript-dom"));

  let rejectPost;
  const rejected = boot((url) => url === "/api/message" ? (rejectPost = Promise.resolve(response({ error: "invalid" }, 400))) : Promise.resolve(response(ready)));
  await tick(); rejected.nodes["#message-input"].value = "bad request"; rejected.nodes["#composer"].listeners.submit({ preventDefault() {} }); await rejectPost; await tick();
  assert.equal(rejected.nodes["#message-input"].value, "bad request", "definite rejection keeps the draft");
  assert.match(textOf(rejected.nodes["#messages"]), /Not sent/);

  let unknownStateCalls = 0, unknownPosts = 0;
  const unknown = boot((url) => {
    if (url === "/api/message") { unknownPosts++; return Promise.reject(new TypeError("offline")); }
    return Promise.resolve(response(unknownStateCalls++ ? accepted : ready));
  });
  await tick(); unknown.nodes["#message-input"].value = "remember this"; unknown.nodes["#composer"].listeners.submit({ preventDefault() {} }); await tick();
  assert.match(textOf(unknown.nodes["#messages"]), /Acceptance not confirmed/);
  unknown.timers.pop()(); await tick();
  assert.match(textOf(unknown.nodes["#messages"]), /Accepted/);
  assert.equal(unknownPosts, 1, "unknown acceptance reconciliation never resends POST");
  process.stdout.write("app-web-client transitions passed\n");
})().catch((error) => { console.error(error); process.exitCode = 1; });

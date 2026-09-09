"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  return { children: [], dataset: {}, value: "", disabled: false, hidden: false, textContent: "", className: "", attributes: {},
    addEventListener(type, fn) { (this.listeners ||= {})[type] = fn; }, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(key, value) { this.attributes[key] = value; }, focus() {}, requestSubmit() { this.listeners.submit({ preventDefault() {} }); }, abort() {} };
}
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, headers: { get: () => "application/json" }, json: async () => body }; }
const task = { id: "task_1", title: "Read notes", status: "open", due_text: "this week", target_count: 4, completed_count: 1, unit: "sections" };
const base = { status: "ready", can_send: true, schema_version: 2, tasks: { revision: 3, tasks: [task], focus_id: null, break_active: false }, messages: [], revision: "state:3", accepted_request_ids: [], pending_message: null, accountability: { activity: { state: "off", helper_available: true, allowed_hosts: [], lease_client_id: null } } };
const keys = ["#composer", "#message-input", "#send-message", "#messages", "#empty-state", ".conversation", "#connection-status", "#form-status", "#recover", "#schema-message", "#current-focus", "#task-add-form", "#task-add-title", "#task-add-submit", "#break-toggle", "#task-status", "#task-list", "#task-empty", "#task-detail", "#task-detail-state", "#task-edit-form", "#task-title", "#task-due", "#task-target", "#task-unit", "#progress-field", "#task-progress", "#task-save", "#focus-toggle", "#complete-task", "#cancel-task", "#reopen-task", "#activity-summary", "#activity-scope", "#activity-reason", "#activity-preview", "#activity-enable", "#activity-pause", "#activity-off"];
const tick = () => new Promise(setImmediate);

function boot(fetchImpl, bridge = null) {
  const nodes = Object.fromEntries(keys.map((key) => [key, element()])); const root = element(); const timers = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/web/workspace.js"), "utf8"), { AbortController, Promise, URLSearchParams, console, document: { querySelector: (key) => nodes[key], createElement: element, documentElement: root }, window: { crypto: { randomUUID: () => "request_123456789" }, performance: { timeOrigin: 1, mark() {}, getEntriesByType: () => [] }, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, EILO_ACTIVITY_EXTENSION_ID: "a".repeat(32), EiloActivityBridge: bridge }, fetch: fetchImpl });
  return { nodes, root, timers };
}

(async () => {
  const calls = []; const bridgeUpdates = [];
  const bridge = { connect: () => ({ ok: true }), update: (activity) => bridgeUpdates.push(activity.sample_request) };
  const active = { ...base, accountability: { activity: { state: "active", helper_available: true, allowed_hosts: [], lease_client_id: "request_123456789", sample_request: { nonce: "next" } } } };
  const app = boot((url, options = {}) => { calls.push([url, options]); if (url.startsWith("/api/state")) return Promise.resolve(response(base)); if (url === "/api/activity") return Promise.resolve(response(active)); if (url === "/api/tasks") return Promise.resolve(response({ error: "conflict" }, 409)); throw new Error(url); }, bridge);
  await tick();
  assert.equal(app.nodes["#current-focus"].textContent, "1 open task", "saved work is primary when focus is optional and unset");
  const rowButton = app.nodes["#task-list"].children[0].children[0]; rowButton.listeners.click();
  assert.equal(app.nodes["#task-title"].value, "Read notes"); assert.equal(calls.filter(([url]) => url === "/api/tasks").length, 0, "selection is local, not focus"); assert.equal(app.nodes["#task-list"].children[0].children[0].attributes["aria-pressed"], "true");
  app.nodes["#task-title"].value = "Unsaved title"; app.nodes["#task-title"].listeners.input(); app.nodes["#task-edit-form"].listeners.submit({ preventDefault() {} }); await tick();
  assert.equal(app.nodes["#task-title"].value, "Unsaved title", "failed save keeps dirty editor values"); assert.notEqual(app.nodes["#task-status"].textContent, "Saved.");
  app.nodes["#activity-enable"].listeners.click(); await tick(); assert.deepEqual(bridgeUpdates, [{ nonce: "next" }], "activity bridge receives current sample request");
  const unsupported = boot((url) => Promise.resolve(response({ ...base, schema_version: 1 }))); await tick(); assert.equal(unsupported.nodes["#task-add-submit"].disabled, true); assert.equal(unsupported.nodes["#schema-message"].hidden, false);
  const otherTask = { ...task, id: "task_2", title: "Draft introduction" };
  const closedTask = { ...task, id: "task_3", status: "completed" };
  const summaryCases = [
    [{ tasks: [task, otherTask, closedTask] }, "2 open tasks"],
    [{ tasks: [] }, "No open tasks"],
    [{ tasks: [closedTask, { ...otherTask, status: "cancelled" }] }, "No open tasks"],
    [{ focus_id: task.id }, "Current focus: Read notes"],
    [{ break_active: true }, "On a break · 1 open task"],
    [{ break_active: true, focus_id: task.id }, "On a break · Current focus: Read notes"],
    [{ break_active: true, tasks: [] }, "On a break · No open tasks"],
  ];
  for (const [changes, expected] of summaryCases) {
    const snapshot = { ...base, tasks: { ...base.tasks, ...changes } };
    const before = JSON.stringify(snapshot);
    const requests = [];
    const display = boot((url, options = {}) => { requests.push([url, options.method]); return Promise.resolve(response(snapshot)); });
    await tick();
    assert.equal(display.nodes["#current-focus"].textContent, expected);
    assert.equal(JSON.stringify(snapshot), before, "summary rendering cannot change task or focus state");
    assert.equal(requests.some(([, method]) => method === "POST"), false, "summary changes require no state mutation");
  }
  process.stdout.write("workspace client transitions passed\n");
})().catch((error) => { console.error(error); process.exitCode = 1; });

(() => {
  "use strict";
  const MAX_TEXT_LENGTH = 12000;
  const POLL_ERROR_INITIAL_MS = 1000;
  const POLL_ERROR_MAX_MS = 15000;
  const clientHeaders = { "X-Eilo-Client": "local-chat" };
  const markNames = ["eilo-submit", "eilo-optimistic-dom", "eilo-acceptance", "eilo-native-transcript-dom"];
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    composer: $("#composer"), input: $("#message-input"), send: $("#send-message"), messages: $("#messages"), empty: $("#empty-state"), conversation: $(".conversation"),
    connection: $("#connection-status"), formStatus: $("#form-status"), recover: $("#recover"), schemaMessage: $("#schema-message"),
    addForm: $("#task-add-form"), addTitle: $("#task-add-title"), addSubmit: $("#task-add-submit"), breakToggle: $("#break-toggle"), taskStatus: $("#task-status"), taskList: $("#task-list"), taskEmpty: $("#task-empty"), detail: $("#task-detail"), detailState: $("#task-detail-state"),
    editForm: $("#task-edit-form"), title: $("#task-title"), due: $("#task-due"), target: $("#task-target"), unit: $("#task-unit"), progressField: $("#progress-field"), progress: $("#task-progress"), save: $("#task-save"), focus: $("#focus-toggle"), complete: $("#complete-task"), cancel: $("#cancel-task"), reopen: $("#reopen-task"),
    activitySummary: $("#activity-summary"), activityScope: $("#activity-scope"), activityReason: $("#activity-reason"), activityPreview: $("#activity-preview"), activityEnable: $("#activity-enable"), activityPause: $("#activity-pause"), activityOff: $("#activity-off"),
  };
  let state = null, selectedTaskId = null, pollTimer = null, pollController = null, pollGeneration = 0, failureDelay = POLL_ERROR_INITIAL_MS, submitting = false, taskSaving = false, localOptimistic = null, localRequestError = null, dismissedPendingRequestId = null, renderedFingerprint = null, renderedTaskFingerprint = null, editorDirty = false, acceptedRequestId = null;
  const activityClientId = requestId();
  let activityBridge = null, activityConnectAllowed = false, leaseTimer = null;
  let taskButtons = new Map();

  function requestId() { return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function mark(name) { if (!window.performance?.mark || !document.documentElement?.dataset) return; window.performance.mark(name); const marks = window.performance.getEntriesByType?.("mark").filter((entry) => markNames.includes(entry.name)).map((entry) => ({ name: entry.name, startTime: entry.startTime })) || []; document.documentElement.dataset.eiloTiming = JSON.stringify({ timeOrigin: window.performance.timeOrigin, marks }); }
  function setText(element, text, kind = "") { element.textContent = text; element.dataset.state = kind; }
  function schemaReady(next = state) { return next?.schema_version === 2 && next?.tasks && Array.isArray(next.tasks.tasks); }
  async function readResponse(response) { if (!(response.headers.get("content-type") || "").includes("application/json")) return {}; try { return await response.json(); } catch { return {}; } }
  async function getState(after, signal) { const response = await fetch(`/api/state${after ? `?after=${encodeURIComponent(after)}` : ""}`, { headers: clientHeaders, cache: "no-store", signal }); const payload = await readResponse(response); if (!response.ok) throw new Error(payload.error || `The local service returned ${response.status}.`); return payload; }
  async function post(path, body) {
    if (["/api/message", "/api/goal"].includes(path) && state?.workspace?.active_chat_id) body = {...body, chat_id:state.workspace.active_chat_id}; const response = await fetch(path, { method: "POST", headers: { ...clientHeaders, "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await readResponse(response); if (!response.ok) { const error = new Error(payload.error || `The local service returned ${response.status}.`); error.status = response.status; throw error; } return payload; }
  function acceptedHasRequest(next, id) { return Array.isArray(next.accepted_request_ids) && next.accepted_request_ids.includes(id); }
  function pendingLabel(status) { return ({ accepted: "Accepted", failed: "Reply failed · history not confirmed", interrupted: "Interrupted", rejected: "Not sent", unconfirmed: "Acceptance not confirmed", sending: "Sending" })[status] || "Sending"; }
  function messageEntries(next) { const entries = (Array.isArray(next.messages) ? next.messages : []).filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string").map((item) => ({ ...item, displayStatus: null })); const pending = next.pending_message; if (pending && pending.request_id !== dismissedPendingRequestId) entries.push({ id: pending.request_id, role: "user", text: pending.text, displayStatus: pending.status }); if (localOptimistic && pending?.request_id !== localOptimistic.request_id) entries.push({ ...localOptimistic, role: "user", displayStatus: localOptimistic.status }); return entries; }
  function renderMessages(next) { const entries = messageEntries(next); const fingerprint = JSON.stringify([entries, next.status, localRequestError]); if (fingerprint === renderedFingerprint) return; renderedFingerprint = fingerprint; elements.messages.replaceChildren(); for (const message of entries) { const item = document.createElement("li"), role = document.createElement("span"), text = document.createElement("p"); item.className = `message message-${message.role}${message.displayStatus ? " message-pending" : ""}`; role.className = "message-role"; role.textContent = message.role === "user" ? "You" : message.origin === "check_in" ? "eïlo check-in" : "eïlo"; text.className = "message-text"; text.textContent = message.text; item.append(role, text); if (message.displayStatus) { const delivery = document.createElement("span"); delivery.className = "message-delivery"; delivery.textContent = pendingLabel(message.displayStatus); item.append(delivery); } elements.messages.append(item); }
    if (next.status === "busy") { const progress = document.createElement("li"); progress.className = "assistant-progress"; progress.textContent = "eïlo is preparing a reply…"; elements.messages.append(progress); }
    elements.empty.hidden = entries.length > 0; elements.conversation.scrollTop = elements.conversation.scrollHeight;
  }
  function selectedTask(next = state) { return schemaReady(next) ? next.tasks.tasks.find((task) => task.id === selectedTaskId) || null : null; }
  function controlLocked(next = state) { return !schemaReady(next) || taskSaving || submitting || next.status === "busy" || next.can_send !== true || ["sending", "accepted"].includes(next.pending_message?.status); }
  function setTaskControlsDisabled(disabled) { [elements.addTitle, elements.addSubmit, elements.breakToggle, elements.title, elements.due, elements.target, elements.unit, elements.progress, elements.save, elements.focus, elements.complete, elements.cancel, elements.reopen].forEach((node) => { node.disabled = disabled; }); }
  function populateEditor(task) { elements.title.value = task.title; elements.due.value = task.due_text || ""; elements.target.value = task.target_count ?? ""; elements.unit.value = task.unit || ""; elements.progress.value = task.completed_count ?? 0; editorDirty = false; }
  function selectTask(id, { populate = true } = {}) { selectedTaskId = id; const task = selectedTask(); if (!task) { elements.detail.hidden = true; return; } elements.detail.hidden = false; if (populate) populateEditor(task); renderedTaskFingerprint = null; renderTasks(state); taskButtons.get(id)?.focus(); }
  function renderTasks(next) {
    const supported = schemaReady(next); elements.schemaMessage.hidden = supported; if (!supported) { setText(elements.schemaMessage, "This workspace needs a service update. Reload after the local service is updated.", "error"); elements.taskList.replaceChildren(); elements.taskEmpty.hidden = false; elements.detail.hidden = true; setTaskControlsDisabled(true); return; }
    const tasks = next.tasks.tasks.filter(task => task.status !== "deleted");
    const openTasks = tasks.filter((task) => task.status === "open");
    const focusTask = openTasks.find((task) => task.id === next.tasks.focus_id);
    const focusSummary = $("#current-focus");
    const workSummary = openTasks.length ? `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}` : "No open tasks";
    if (focusSummary) focusSummary.textContent = `${next.tasks.break_active ? "On a break · " : ""}${focusTask ? `Current focus: ${focusTask.title}` : workSummary}`;
    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) { selectedTaskId = null; editorDirty = false; }
    const fingerprint = JSON.stringify([next.tasks.revision, selectedTaskId, next.tasks.focus_id, controlLocked(next)]);
    if (fingerprint === renderedTaskFingerprint) return;
    const keyboardTaskId = [...taskButtons].find(([, button]) => button === document.activeElement)?.[0];
    renderedTaskFingerprint = fingerprint; elements.taskEmpty.hidden = tasks.length > 0; elements.taskList.replaceChildren(); taskButtons = new Map();
    for (const task of tasks) { const item = document.createElement("li"), button = document.createElement("button"), stateText = document.createElement("span"); item.className = `task-row task-${task.status}${task.id === selectedTaskId ? " is-selected" : ""}${task.id === next.tasks.focus_id ? " is-focus" : ""}`; button.type = "button"; button.setAttribute("aria-pressed", String(task.id === selectedTaskId)); button.textContent = task.title; button.addEventListener("click", () => selectTask(task.id)); taskButtons.set(task.id, button); stateText.textContent = task.id === next.tasks.focus_id ? "Current focus" : task.status; item.append(button, stateText); if (task.due_text) { const due = document.createElement("span"); due.textContent = task.due_text; item.append(due); } if (task.target_count !== null) { const quantity = document.createElement("span"); quantity.textContent = `${task.completed_count} of ${task.target_count}${task.unit ? ` ${task.unit}` : ""}`; item.append(quantity); } elements.taskList.append(item); }
    if (keyboardTaskId) taskButtons.get(keyboardTaskId)?.focus();
    const task = selectedTask(next); elements.detail.hidden = !task; if (task) { if (!editorDirty) populateEditor(task); elements.detailState.textContent = `${task.id === next.tasks.focus_id ? "Current focus · " : ""}${task.status}${task.due_text ? ` · ${task.due_text}` : ""}`; elements.progressField.hidden = task.target_count === null; elements.focus.hidden = task.status !== "open"; elements.focus.textContent = task.id === next.tasks.focus_id ? "Clear current focus" : "Set current focus"; elements.complete.hidden = task.status !== "open"; elements.cancel.hidden = task.status !== "open"; elements.reopen.hidden = task.status === "open"; }
    elements.breakToggle.textContent = next.tasks.break_active ? "Resume" : "Take a break"; setTaskControlsDisabled(controlLocked(next));
  }
  function renderActivity(accountability = {}) { const activity = accountability.activity || { state: "off" }; const hosts = Array.isArray(activity.allowed_hosts) && activity.allowed_hosts.length ? activity.allowed_hosts.join(", ") : "No approved sites"; elements.activitySummary.textContent = activity.state === "active" ? "Activity context is enabled locally." : activity.state === "paused" ? "Activity context is paused." : "Activity sharing is off."; elements.activityScope.textContent = `Approved sites: ${hosts}. This is a privacy permission, not a productivity rating.`; elements.activityReason.textContent = activity.reason || ""; const preview = activity.preview; elements.activityPreview.textContent = preview?.kind === "approved_study_context" ? `Shared with eïlo: ${preview.origin || "approved origin"} · ${preview.title || "approved title"}` : ["activity_unshared", "unknown"].includes(preview?.kind) ? "Activity details not shared" : ""; elements.activityEnable.disabled = activity.state === "active" || !activity.helper_available; elements.activityPause.disabled = activity.state !== "active"; elements.activityOff.disabled = activity.state === "off"; }
  function render(next) { state = next; if (localOptimistic && acceptedHasRequest(next, localOptimistic.request_id)) { if (elements.input.value === localOptimistic.text) elements.input.value = ""; acceptedRequestId = localOptimistic.request_id; localOptimistic = null; localRequestError = null; mark("eilo-acceptance"); } const busy = next.status === "busy"; const available = next.can_send === true && !busy; elements.input.disabled = !available || taskSaving; elements.send.disabled = !available || !elements.input.value.trim() || submitting || taskSaving; elements.recover.hidden = next.recovery_pending !== true; elements.recover.disabled = busy || submitting || taskSaving; renderMessages(next); if (acceptedRequestId && next.status !== "busy" && !next.pending_message) { mark("eilo-native-transcript-dom"); acceptedRequestId = null; } renderTasks(next); renderActivity(next.accountability); const activity = next.accountability?.activity; if (activityBridge && activity?.lease_client_id === activityClientId) activityBridge.update?.(activity); else if (activityBridge) disconnectActivityBridge(); if (busy) { setText(elements.connection, "eïlo is responding…", "busy"); setText(elements.formStatus, "Accepted. eïlo is preparing a reply."); } else if (next.status === "error") { setText(elements.connection, "Local service needs attention.", "error"); setText(elements.formStatus, next.error || "The local service reported an error.", "error"); } else if (localRequestError) { setText(elements.connection, "Connected locally"); setText(elements.formStatus, localRequestError, "error"); } else { setText(elements.connection, "Connected locally"); if (!submitting) setText(elements.formStatus, ""); } updateLease(); }
  function abortPoll() { window.clearTimeout(pollTimer); pollTimer = null; pollGeneration += 1; pollController?.abort(); pollController = null; }
  function schedulePoll(delay = 0, force = false) { window.clearTimeout(pollTimer); pollTimer = window.setTimeout(() => pollState(force), delay); }
  async function pollState(force = false) { const generation = ++pollGeneration, controller = new AbortController(); pollController = controller; try { const next = await getState(force ? null : state?.revision, controller.signal); if (generation !== pollGeneration) return; pollController = null; failureDelay = POLL_ERROR_INITIAL_MS; render(next); schedulePoll(); } catch (error) { if (generation !== pollGeneration || error.name === "AbortError") return; pollController = null; elements.input.disabled = true; elements.send.disabled = true; setTaskControlsDisabled(true); setText(elements.connection, "Local service is unavailable.", "error"); setText(elements.formStatus, "Trying to reconnect. Your unsent draft is still here.", "error"); failureDelay = Math.min(failureDelay * 2, POLL_ERROR_MAX_MS); schedulePoll(failureDelay, true); } }
  async function saveTask(operations) {
    if (controlLocked() || !operations.length) return null;
    const returnFocus = document.activeElement;
    abortPoll();
    taskSaving = true;
    setText(elements.taskStatus, "Saving…");
    render(state);
    try {
      const next = await post("/api/tasks", {
        operations, request_id: requestId(), based_on_revision: state.tasks.revision,
      });
      setText(elements.taskStatus, "Saved.");
      editorDirty = false;
      render(next);
      schedulePoll();
      return next;
    } catch (error) {
      setText(elements.taskStatus, error.message || "Could not save this task change.", "error");
      schedulePoll(0, true);
      return null;
    } finally {
      taskSaving = false;
      if (state) render(state);
      if (!document.activeElement || document.activeElement === document.body || document.activeElement === returnFocus) {
        if (returnFocus?.hidden) taskButtons.get(selectedTaskId)?.focus();
        else returnFocus?.focus?.();
      }
    }
  }
  async function submitMessage(event) { event.preventDefault(); const text = elements.input.value; mark("eilo-submit"); if (!text.trim() || text.length > MAX_TEXT_LENGTH || submitting || !state || !state.can_send || state.status === "busy") return; abortPoll(); submitting = true; localRequestError = null; localOptimistic = { request_id: requestId(), text, status: "sending" }; render(state); mark("eilo-optimistic-dom"); try { render(await post("/api/message", { text, request_id: localOptimistic.request_id })); schedulePoll(); } catch (error) { const rejected = [400, 403, 409, 415, 503].includes(error.status); localOptimistic.status = rejected ? "rejected" : "unconfirmed"; localRequestError = rejected ? `Not sent: ${error.message || "Please try again."}` : "Acceptance not confirmed. Check the connection before sending again."; render(state); schedulePoll(failureDelay, true); } finally { submitting = false; if (state) render(state); } }
  function updateLease() { if (state?.accountability?.activity?.state !== "active" || state.accountability.activity.lease_client_id !== activityClientId) { window.clearInterval?.(leaseTimer); leaseTimer = null; return; } if (!leaseTimer) leaseTimer = window.setInterval?.(() => post("/api/activity/lease", { client_id: activityClientId }).catch(() => {}), 3000); }
  function disconnectActivityBridge() { activityBridge?.disconnect?.(); activityBridge = null; window.clearInterval?.(leaseTimer); leaseTimer = null; }
  async function activityControl(action) { abortPoll(); try { const next = await post("/api/activity", { action, client_id: activityClientId }); render(next); if (action !== "enable") { activityConnectAllowed = false; disconnectActivityBridge(); } else { activityConnectAllowed = true; connectActivityBridge(); } schedulePoll(); } catch (error) { setText(elements.taskStatus, error.message || "Could not update activity sharing.", "error"); schedulePoll(0, true); } }
  async function connectActivityBridge() { if (!activityConnectAllowed || activityBridge || state?.accountability?.activity?.lease_client_id !== activityClientId) return; const extensionId = window.EILO_ACTIVITY_EXTENSION_ID; if (!/^[a-p]{32}$/.test(extensionId) || !window.EiloActivityBridge?.connect) return; const result = window.EiloActivityBridge.connect(extensionId, activityClientId, async (nonce, observation) => { abortPoll(); try { render(await post("/api/activity/observation", { client_id: activityClientId, nonce, observation })); schedulePoll(); } catch { schedulePoll(0, true); } }, () => {}); if (result?.ok) { activityBridge = window.EiloActivityBridge; activityBridge.update?.(state.accountability.activity); } }

  elements.composer.addEventListener("submit", submitMessage);
  elements.input.addEventListener("input", () => { if (state?.pending_message && ["failed", "interrupted"].includes(state.pending_message.status)) dismissedPendingRequestId = state.pending_message.request_id; if (localRequestError || ["rejected", "unconfirmed"].includes(localOptimistic?.status)) { localRequestError = null; localOptimistic = null; if (state) render(state); } if (state) elements.send.disabled = !state.can_send || state.status === "busy" || !elements.input.value.trim() || submitting || taskSaving; });
  elements.input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); elements.composer.requestSubmit(); } });
  elements.addForm.addEventListener("submit", (event) => { event.preventDefault(); const title = elements.addTitle.value.trim(); if (!title) return; saveTask([{ op: "add", temp_id: `new_${requestId().replace(/[^A-Za-z0-9_]/g, "").slice(0, 32)}`, title, due_text: null, target_count: null, unit: null }]).then((next) => { if (next) elements.addTitle.value = ""; }); });
  elements.breakToggle.addEventListener("click", () => saveTask([{ op: "break", active: !state.tasks.break_active }]));
  elements.focus.addEventListener("click", () => { const task = selectedTask(); if (task) saveTask([{ op: "focus", task_id: task.id === state.tasks.focus_id ? null : task.id }]); });
  elements.complete.addEventListener("click", () => { const task = selectedTask(); if (task) saveTask([{ op: "complete", task_id: task.id }]); });
  elements.cancel.addEventListener("click", () => { const task = selectedTask(); if (task) saveTask([{ op: "cancel", task_id: task.id }]); });
  elements.reopen.addEventListener("click", () => { const task = selectedTask(); if (task) saveTask([{ op: "reopen", task_id: task.id }]); });
  [elements.title, elements.due, elements.target, elements.unit, elements.progress].forEach((input) => input.addEventListener("input", () => { editorDirty = true; }));
  elements.editForm.addEventListener("submit", (event) => { event.preventDefault(); const task = selectedTask(); if (!task) return; const title = elements.title.value.trim(), due = elements.due.value.trim() || null, target = elements.target.value === "" ? null : Number(elements.target.value), unit = elements.unit.value.trim() || null, progress = elements.progress.value === "" ? 0 : Number(elements.progress.value); const edit = { op: "edit", task_id: task.id }; if (title !== task.title) edit.title = title; if (due !== task.due_text) edit.due_text = due; if (target !== task.target_count) edit.target_count = target; if (unit !== task.unit) edit.unit = unit; const operations = Object.keys(edit).length > 2 ? [edit] : []; if (target !== null && task.target_count !== null && progress !== task.completed_count) operations.push({ op: "progress", task_id: task.id, completed_count: progress }); saveTask(operations).then((next) => { if (next) editorDirty = false; }); });
  elements.recover.addEventListener("click", async () => { abortPoll(); try { render(await post("/api/recover", {})); schedulePoll(); } catch (error) { setText(elements.formStatus, error.message || "Could not recover the saved reply.", "error"); schedulePoll(0, true); } });
  elements.activityEnable.addEventListener("click", () => activityControl("enable")); elements.activityPause.addEventListener("click", () => activityControl("pause")); elements.activityOff.addEventListener("click", () => activityControl("off"));
  window.addEventListener?.("pagehide", () => { disconnectActivityBridge(); if (state?.accountability?.activity?.state === "active" && state.accountability.activity.lease_client_id === activityClientId) fetch("/api/activity", { method: "POST", keepalive: true, headers: { ...clientHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ action: "off", client_id: activityClientId }) }); });
  pollState(true);
})();

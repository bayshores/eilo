(() => {
  "use strict";

  const POLL_ERROR_MAX_MS = 15000;
  const POLL_ERROR_INITIAL_MS = 1000;
  const MAX_TEXT_LENGTH = 12000;
  const clientHeaders = { "X-Eilo-Client": "local-chat" };
  const markNames = ["eilo-submit", "eilo-optimistic-dom", "eilo-acceptance", "eilo-native-transcript-dom"];
  const elements = {
    composer: document.querySelector("#composer"), input: document.querySelector("#message-input"),
    send: document.querySelector("#send-message"), newConversation: document.querySelector("#new-conversation"),
    messages: document.querySelector("#messages"), empty: document.querySelector("#empty-state"),
    connection: document.querySelector("#connection-status"), formStatus: document.querySelector("#form-status"),
    conversation: document.querySelector(".conversation"),
    goalSummary: document.querySelector("#goal-summary"), goalForm: document.querySelector("#goal-form"), goalInput: document.querySelector("#goal-input"),
    goalBreak: document.querySelector("#goal-break"), goalResume: document.querySelector("#goal-resume"), goalCancel: document.querySelector("#goal-cancel"),
    accountabilityStatus: document.querySelector("#accountability-status"), activityReason: document.querySelector("#activity-reason"),
    activityScope: document.querySelector("#activity-scope"), activityPreview: document.querySelector("#activity-preview"), activityEnable: document.querySelector("#activity-enable"), activityPause: document.querySelector("#activity-pause"), activityOff: document.querySelector("#activity-off"),
  };
  let state = null;
  let pollController = null;
  let pollTimer = null;
  let pollGeneration = 0;
  let failureDelay = POLL_ERROR_INITIAL_MS;
  let submitting = false;
  let renderedFingerprint = null;
  let localRequestError = null;
  let localOptimistic = null;
  let dismissedPendingRequestId = null;
  let reconcileWithoutRevision = false;
  let performanceRequestId = null;
  let acceptanceMarkedForId = null;
  let lastReceivedStateRevision = null;
  const activityClientId = requestId();
  let leaseTimer = null;
  let activityConnectAllowed = false;
  let activityBridge = null;

  function setConnection(message, kind = "ready") { elements.connection.textContent = message; elements.connection.dataset.state = kind; }
  function setFormStatus(message = "", kind = "") { elements.formStatus.textContent = message; elements.formStatus.dataset.state = kind; }
  function requestId() { return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  // These marks measure JavaScript/DOM work only. They do not measure physical paint.
  function publishTiming() {
    const performance = window.performance;
    if (!performance?.getEntriesByType || !document.documentElement?.dataset) return;
    const marks = performance.getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("eilo-"))
      .map((entry) => ({ name: entry.name, startTime: entry.startTime }));
    document.documentElement.dataset.eiloTiming = JSON.stringify({ timeOrigin: performance.timeOrigin, marks });
  }
  function mark(name) { if (window.performance?.mark) window.performance.mark(name); publishTiming(); }
  function beginPerformanceRequest(id) {
    performanceRequestId = id;
    for (const name of markNames) window.performance?.clearMarks?.(name);
    mark("eilo-submit");
  }

  async function readResponse(response) {
    if (!(response.headers.get("content-type") || "").includes("application/json")) return {};
    try { return await response.json(); } catch { return {}; }
  }
  async function getState(after, signal) {
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    const response = await fetch(`/api/state${query}`, { headers: clientHeaders, cache: "no-store", signal });
    const payload = await readResponse(response);
    if (!response.ok) throw new Error(payload.error || `The local service returned ${response.status}.`);
    return payload;
  }
  async function post(path, body) {
    if (["/api/message", "/api/goal"].includes(path) && state?.workspace?.active_chat_id) body = {...body, chat_id:state.workspace.active_chat_id};
    const response = await fetch(path, { method: "POST", headers: { ...clientHeaders, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await readResponse(response);
    if (!response.ok) { const error = new Error(payload.error || `The local service returned ${response.status}.`); error.status = response.status; throw error; }
    return payload;
  }
  function acceptedHasRequest(nextState, id) { return Array.isArray(nextState.accepted_request_ids) && nextState.accepted_request_ids.includes(id); }
  function pendingLabel(status) {
    return ({ accepted: "Accepted", failed: "Reply failed · history not confirmed", interrupted: "Interrupted", rejected: "Not sent", unconfirmed: "Acceptance not confirmed", sending: "Sending" })[status] || "Sending";
  }
  function entriesFor(nextState) {
    const nativeMessages = Array.isArray(nextState.messages) ? nextState.messages : [];
    const entries = nativeMessages.filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.text === "string").map((message) => ({ ...message, displayStatus: null }));
    const pending = nextState.pending_message;
    if (pending && pending.request_id !== dismissedPendingRequestId && typeof pending.request_id === "string" && typeof pending.text === "string") entries.push({ id: pending.request_id, role: "user", text: pending.text, displayStatus: pending.status });
    if (localOptimistic && pending?.request_id !== localOptimistic.request_id) entries.push({ id: localOptimistic.request_id, role: "user", text: localOptimistic.text, displayStatus: localOptimistic.status });
    return entries;
  }
  function reconcileOptimistic(nextState) {
    if (!localOptimistic || !acceptedHasRequest(nextState, localOptimistic.request_id)) return;
    const acceptedId = localOptimistic.request_id;
    if (elements.input.value === localOptimistic.text) elements.input.value = "";
    localOptimistic = null;
    localRequestError = null;
    if (acceptanceMarkedForId !== acceptedId) {
      mark("eilo-acceptance");
      acceptanceMarkedForId = acceptedId;
    }
  }
  function messageFingerprint(nextState, entries) { return JSON.stringify([nextState.status, entries, localRequestError, localOptimistic]); }
  function renderMessages(nextState) {
    const entries = entriesFor(nextState);
    const fingerprint = messageFingerprint(nextState, entries);
    if (fingerprint === renderedFingerprint) return;
    renderedFingerprint = fingerprint;
    elements.messages.replaceChildren();
    for (const message of entries) {
      const item = document.createElement("li");
      item.className = `message message-${message.role}${message.displayStatus ? " message-pending" : ""}`;
      const role = document.createElement("span"); role.className = "message-role"; role.textContent = message.role === "user" ? "You" : message.origin === "check_in" ? "eïlo check-in" : "eïlo";
      const text = document.createElement("p"); text.className = "message-text"; text.textContent = message.text;
      item.append(role, text);
      if (message.displayStatus) { const delivery = document.createElement("span"); delivery.className = `message-delivery message-delivery-${message.displayStatus}`; delivery.textContent = pendingLabel(message.displayStatus); item.append(delivery); }
      elements.messages.append(item);
    }
    if (nextState.status === "busy") { const progress = document.createElement("li"); progress.className = "assistant-progress"; progress.setAttribute("aria-label", "eïlo is preparing a reply"); progress.textContent = "eïlo is preparing a reply…"; elements.messages.append(progress); }
    elements.empty.hidden = entries.length > 0;
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
  }
  function maybeMarkNativeTranscript(nextState) {
    if (performanceRequestId && nextState.status !== "busy" && acceptedHasRequest(nextState, performanceRequestId) && nextState.pending_message?.request_id !== performanceRequestId) { mark("eilo-native-transcript-dom"); performanceRequestId = null; }
  }
  function render(nextState) {
    reconcileOptimistic(nextState);
    if (!performanceRequestId && nextState.pending_message?.status === "accepted") performanceRequestId = nextState.pending_message.request_id;
    const receivedNewState = nextState.revision !== lastReceivedStateRevision;
    if (receivedNewState) {
      window.performance?.clearMarks?.("eilo-state-received");
      window.performance?.clearMarks?.("eilo-state-rendered");
      mark("eilo-state-received");
    }
    state = nextState;
    renderAccountability(nextState.accountability);
    const busy = nextState.status === "busy";
    const available = nextState.can_send === true && !busy;
    elements.input.disabled = !available;
    elements.send.disabled = !available || !elements.input.value.trim() || submitting;
    elements.newConversation.disabled = busy || submitting;
    renderMessages(nextState);
    if (activityBridge && nextState.accountability?.activity?.lease_client_id === activityClientId) activityBridge.update?.(nextState.accountability.activity);
    else if (activityBridge) disconnectActivityBridge();
    if (receivedNewState) {
      mark("eilo-state-rendered");
      lastReceivedStateRevision = nextState.revision;
    }
    maybeMarkNativeTranscript(nextState);
    if (busy) { setConnection("eïlo is responding…", "busy"); setFormStatus("Accepted. eïlo is preparing a reply."); }
    else if (nextState.status === "error") { setConnection("Local service needs attention.", "error"); setFormStatus(nextState.error || "The local service reported an error.", "error"); }
    else if (localRequestError) { setConnection("Connected locally"); setFormStatus(localRequestError, "error"); }
    else { setConnection("Connected locally"); if (!submitting) setFormStatus(""); }
    updateLease();
  }

  function renderAccountability(accountability = {}) {
    const goal = accountability.goal || { status: "none", text: "" };
    const activity = accountability.activity || { state: "off", allowed_hosts: ["leetcode.com", "neetcode.io", "docs.python.org"] };
    elements.goalSummary.textContent = goal.status === "active" ? `Goal: ${goal.text}` : goal.status === "break" ? `On a break: ${goal.text}` : "No active goal.";
    elements.goalBreak.disabled = goal.status !== "active";
    elements.goalResume.disabled = goal.status !== "break";
    elements.goalCancel.disabled = goal.status === "none";
    const hosts = Array.isArray(activity.allowed_hosts) && activity.allowed_hosts.length ? activity.allowed_hosts.join(", ") : "No approved sites";
    elements.activityScope.textContent = `Approved sites: ${hosts}. This is a privacy permission, not a productivity rating.`;
    elements.activityReason.textContent = activity.reason || (activity.state === "active" ? "Activity context is enabled locally." : "Activity context is off.");
    const ownsLease = activity.lease_client_id === activityClientId;
    elements.activityEnable.disabled = activity.state === "active" || !activity.helper_available;
    elements.activityPause.disabled = activity.state !== "active";
    elements.activityOff.disabled = activity.state === "off";
    elements.activityReason.textContent = activity.state === "active" ? `Activity on. ${activity.reason || (ownsLease ? "Enabled for this page." : "Another page owns this collection lease.")}` : activity.reason || "Activity context is off.";
    const preview = activity.preview;
    elements.activityPreview.textContent = preview?.kind === "approved_study_context" ? `Shared with eïlo: app: Google Chrome · ${preview.origin || "approved origin"} · ${preview.title || "approved title"}` : ["activity_unshared", "unknown"].includes(preview?.kind) ? "Activity details not shared" : "Activity unshared";
  }

  async function control(path, body) {
    abortPoll();
    elements.accountabilityStatus.textContent = "Saving…";
    try { const nextState = await post(path, body); elements.accountabilityStatus.textContent = "Saved."; render(nextState); schedulePoll(); return nextState; }
    catch (error) { elements.accountabilityStatus.textContent = error.message || "Could not save this change."; elements.accountabilityStatus.dataset.state = "error"; schedulePoll(); return null; }
  }
  function updateLease() {
    if (state?.accountability?.activity?.state !== "active" || state.accountability.activity.lease_client_id !== activityClientId) {
      window.clearInterval?.(leaseTimer); leaseTimer = null; return;
    }
    if (leaseTimer) return;
    leaseTimer = window.setInterval?.(() => { post("/api/activity/lease", { client_id: activityClientId }).catch(() => {}); }, 3000);
  }
  function disconnectActivityBridge() { activityBridge?.disconnect?.(); activityBridge = null; }
  async function connectActivityBridge() {
    if (!activityConnectAllowed || state?.accountability?.activity?.lease_client_id !== activityClientId || activityBridge) return;
    const extensionId = window.EILO_ACTIVITY_EXTENSION_ID;
    if (!/^[a-p]{32}$/.test(extensionId) || !window.EiloActivityBridge?.connect) { elements.accountabilityStatus.textContent = "Chrome context unavailable. Open eïlo in Chrome and enter the installed extension ID."; return; }
    const result = window.EiloActivityBridge.connect(extensionId, activityClientId, async (nonce, observation) => {
      try { abortPoll(); const nextState = await post("/api/activity/observation", { client_id: activityClientId, nonce, observation }); render(nextState); schedulePoll(); }
      catch (error) { elements.accountabilityStatus.textContent = "Chrome context unavailable."; schedulePoll(); }
    }, (connected, reason) => { elements.accountabilityStatus.textContent = connected ? "Chrome context connected." : reason || "Chrome context unavailable."; });
    if (!result?.ok) { elements.accountabilityStatus.textContent = "Chrome context unavailable."; return; }
    activityBridge = window.EiloActivityBridge;
    activityBridge.update?.(state.accountability.activity);
  }

  function abortPoll() { window.clearTimeout(pollTimer); pollTimer = null; pollGeneration += 1; if (pollController) pollController.abort(); pollController = null; }
  function schedulePoll(delay = 0, forceImmediate = false) { window.clearTimeout(pollTimer); pollTimer = window.setTimeout(() => pollState(forceImmediate), delay); }
  async function pollState(forceImmediate = false) {
    const generation = ++pollGeneration;
    const controller = new AbortController();
    pollController = controller;
    const after = !forceImmediate && !reconcileWithoutRevision ? state?.revision : null;
    try {
      const nextState = await getState(after, controller.signal);
      if (generation !== pollGeneration) return;
      pollController = null;
      failureDelay = POLL_ERROR_INITIAL_MS;
      reconcileWithoutRevision = false;
      render(nextState);
      schedulePoll();
    } catch (error) {
      if (generation !== pollGeneration || error.name === "AbortError") return;
      pollController = null;
      elements.input.disabled = true; elements.send.disabled = true; elements.newConversation.disabled = true;
      setConnection("Local service is unavailable.", "error");
      setFormStatus("Trying to reconnect. Your unsent draft is still here.", "error");
      failureDelay = Math.min(failureDelay * 2, POLL_ERROR_MAX_MS);
      schedulePoll(failureDelay, reconcileWithoutRevision);
    }
  }

  async function submitMessage(event) {
    event.preventDefault();
    const submittedText = elements.input.value;
    if (!submittedText.trim() || submittedText.length > MAX_TEXT_LENGTH || submitting || !state || !state.can_send || state.status === "busy") return;
    const id = requestId();
    abortPoll();
    submitting = true;
    localRequestError = null;
    localOptimistic = { request_id: id, text: submittedText, status: "sending" };
    beginPerformanceRequest(id);
    render(state);
    mark("eilo-optimistic-dom");
    setFormStatus("Sending…");
    try {
      const nextState = await post("/api/message", { text: submittedText, request_id: id });
      render(nextState);
      schedulePoll();
    } catch (error) {
      const rejectedBeforeAcceptance = [400, 403, 409, 415, 503].includes(error.status);
      localOptimistic.status = rejectedBeforeAcceptance ? "rejected" : "unconfirmed";
      localRequestError = rejectedBeforeAcceptance ? `Not sent: ${error.message || "Please try again."}` : "Acceptance not confirmed. Check the connection before sending again.";
      reconcileWithoutRevision = !rejectedBeforeAcceptance;
      render(state);
      schedulePoll(failureDelay, reconcileWithoutRevision);
    } finally {
      submitting = false;
      if (state) render(state);
    }
  }
  async function startNewConversation() {
    if (submitting || !state || state.status === "busy") return;
    abortPoll();
    submitting = true;
    localRequestError = null;
    elements.newConversation.disabled = true;
    setFormStatus("Starting a new conversation…");
    try {
      const nextState = await post("/api/new", {});
      renderedFingerprint = null; localRequestError = null; localOptimistic = null; dismissedPendingRequestId = null; performanceRequestId = null; acceptanceMarkedForId = null;
      render(nextState);
      elements.input.focus();
      schedulePoll();
    } catch (error) {
      localRequestError = error.message || "A new conversation could not be started.";
      render(state);
      schedulePoll();
    } finally {
      submitting = false;
      if (state) render(state);
    }
  }

  elements.composer.addEventListener("submit", submitMessage);
  elements.goalForm.addEventListener("submit", (event) => { event.preventDefault(); const text = elements.goalInput.value.trim(); if (text) control("/api/goal", { action: "set", text, request_id: requestId() }); });
  elements.goalBreak.addEventListener("click", () => control("/api/goal", { action: "break", text: "", request_id: requestId() }));
  elements.goalResume.addEventListener("click", () => control("/api/goal", { action: "resume", text: "", request_id: requestId() }));
  elements.goalCancel.addEventListener("click", () => control("/api/goal", { action: "cancel", text: "", request_id: requestId() }));
  elements.activityEnable.addEventListener("click", async () => { activityConnectAllowed = true; await control("/api/activity", { action: "enable", client_id: activityClientId }); await connectActivityBridge(); });
  elements.activityPause.addEventListener("click", async () => { activityConnectAllowed = false; disconnectActivityBridge(); await control("/api/activity", { action: "pause", client_id: activityClientId }); });
  elements.activityOff.addEventListener("click", async () => { activityConnectAllowed = false; disconnectActivityBridge(); await control("/api/activity", { action: "off", client_id: activityClientId }); });
  elements.newConversation.addEventListener("click", startNewConversation);
  elements.input.addEventListener("input", () => {
    if (state?.pending_message && ["failed", "interrupted"].includes(state.pending_message.status)) dismissedPendingRequestId = state.pending_message.request_id;
    if (localRequestError || localOptimistic?.status === "rejected" || localOptimistic?.status === "unconfirmed") { localRequestError = null; localOptimistic = null; if (state) render(state); }
    if (state) elements.send.disabled = !state.can_send || state.status === "busy" || !elements.input.value.trim() || submitting;
  });
  elements.input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); elements.composer.requestSubmit(); } });
  window.addEventListener?.("pagehide", () => { disconnectActivityBridge(); if (state?.accountability?.activity?.state === "active" && state.accountability.activity.lease_client_id === activityClientId) fetch("/api/activity", { method: "POST", keepalive: true, headers: { ...clientHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ action: "off", client_id: activityClientId }) }); });
  pollState(true);
})();

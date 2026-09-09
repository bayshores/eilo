"use strict";

const choices = () => [...document.querySelectorAll("input[type=checkbox]:checked")].map((input) => input.value);
const status = document.querySelector("#status");
async function request(action) {
  const origins = choices();
  if (!origins.length) { status.textContent = "Select at least one site."; return; }
  try {
    const changed = await chrome.permissions[action]({ origins });
    status.textContent = changed ? (action === "request" ? "Selected sites granted." : "Selected sites revoked.") : "No permission change was made.";
  } catch { status.textContent = "Chrome could not change those site permissions."; }
}
document.querySelector("#grant").addEventListener("click", () => request("request"));
document.querySelector("#revoke").addEventListener("click", () => request("remove"));

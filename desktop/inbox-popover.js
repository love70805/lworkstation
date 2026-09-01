const statusValue = document.querySelector("#popover-status");
const errorRow = document.querySelector("#popover-error-row");
const errorValue = document.querySelector("#popover-error");
const popoverCard = document.querySelector(".popover-card");
const { classifyErpState, getPopoverPresentation } = window.LworkstationShellState;

window.lucide?.createIcons();

function render(state) {
  if (!state) return;
  document.documentElement.dataset.appearance = state.appearance === "dark" ? "dark" : "light";
  const presentation = getPopoverPresentation(state.inbox || {}, state.inbox?.flow || {});
  statusValue.textContent = presentation.showError ? "异常" : presentation.status;
  errorRow.hidden = !presentation.showError;
  errorValue.textContent = presentation.error || "";
  document.querySelector("main")?.setAttribute("aria-label", classifyErpState(state.inbox || {}, state.inbox?.flow || {}).aria);
  requestResize();
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  void window.inboxPopover.close();
});
window.inboxPopover.onState(render);
window.inboxPopover.getState().then(render);
function requestResize() {
  const height = Math.ceil(popoverCard?.scrollHeight || 0) + 6;
  if (height > 0) void window.inboxPopover.resize(height);
}
window.addEventListener("load", () => { popoverCard?.focus(); requestResize(); });

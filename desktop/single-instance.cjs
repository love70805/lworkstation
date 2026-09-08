// Electron scopes its native process singleton to app.getPath("userData").
// Call only after profile overrides, before loading persistent services/sessions.
function acquireDesktopInstance(app) {
  const acquired = app.requestSingleInstanceLock();
  let window = null;
  let activationPending = false;

  function activate() {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    activationPending = false;
  }

  if (acquired) {
    app.on("second-instance", () => {
      activationPending = true;
      activate();
    });
  }

  return {
    acquired,
    windowReady(value) {
      window = value;
      if (activationPending) activate();
    },
  };
}

module.exports = { acquireDesktopInstance };

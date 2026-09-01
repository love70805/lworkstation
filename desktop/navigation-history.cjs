function historyFor(webContents) {
  const history = webContents?.navigationHistory;
  if (!history) return null;
  return history;
}

function navigationState(webContents) {
  const history = historyFor(webContents);
  return {
    canGoBack: Boolean(history?.canGoBack()),
    canGoForward: Boolean(history?.canGoForward()),
  };
}

function navigateHistory(webContents, direction) {
  const history = historyFor(webContents);
  const backward = direction === "back";
  const available = backward ? history?.canGoBack() : history?.canGoForward();
  if (!history || !available) {
    return { ok: false, error: backward ? "当前页面没有可后退记录" : "当前页面没有可前进记录" };
  }
  if (backward) history.goBack();
  else history.goForward();
  return { ok: true };
}

module.exports = { navigationState, navigateHistory };

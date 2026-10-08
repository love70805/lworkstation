function contextKey(context) {
  if (!context?.workspaceId || !context?.memberId || !context?.visibility) return "";
  return [context.workspaceId, context.memberId, context.visibility].join("\u001f");
}

function cloneContext(context) {
  return context ? {
    workspaceId: context.workspaceId,
    memberId: context.memberId,
    visibility: context.visibility,
  } : null;
}

function extensionLoadFailureState(base, loaded, error) {
  const source = loaded ? { ...base, ...loaded } : { ...base };
  return {
    ...source,
    status: "failed",
    message: loaded ? `安全收件配置失败：${error?.message || String(error)}` : (error?.message || String(error)),
  };
}

function normalizeConfigurationResult(result) {
  return {
    ok: result?.ok === true,
    failures: Array.isArray(result?.failures)
      ? result.failures.map((failure) => failure?.tabId).filter(Boolean)
      : [],
    committedContext: result?.ok === true ? cloneContext(result.committedContext) : null,
  };
}

function configurationHttpResult(result) {
  const normalized = normalizeConfigurationResult(result);
  if (!normalized.ok) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "INBOX_EXTENSION_CONFIGURATION_FAILED",
        message: "桌面扩展安全收件配置失败，请重试工作区上下文同步。",
      },
      failures: normalized.failures,
    };
  }
  return {
    ok: true,
    status: 200,
    body: null,
    failures: [],
  };
}

function createWorkspaceContextCoordinator() {
  let committedContext = null;
  let pendingContext = null;
  const configured = new Map();
  let applyChain = Promise.resolve();

  // Deferred targets are declared by the desktop lifecycle, never by IPC.
  // They have no running extension to configure; opening one joins this queue.
  const isDeferred = target => target?.deferred === true && !target.extensionId && !target.session;
  const loaded = targets => targets.filter(target => !isDeferred(target) && target?.extensionId && target?.session);

  function isFullyConfigured(targets = []) {
    const key = contextKey(committedContext);
    if (!key) return false;
    const loadedTargets = loaded(targets);
    return targets.length > 0 && loadedTargets.length + targets.filter(isDeferred).length === targets.length && loadedTargets.every((target) => {
      const entry = configured.get(target.tabId);
      return entry?.contextKey === key && entry.extensionId === target.extensionId;
    });
  }

  function recordConfigured(tabId, extensionId, context = committedContext) {
    const key = contextKey(context);
    if (!key || !tabId || !extensionId) return false;
    configured.set(tabId, { contextKey: key, extensionId });
    return true;
  }

  function invalidate(tabId) {
    if (tabId) configured.delete(tabId);
    committedContext = null;
  }

  function forget(tabId) {
    if (tabId) configured.delete(tabId);
  }

  async function applyInternal(context, targets, configure) {
    const nextKey = contextKey(context);
    if (!nextKey) throw new Error("缺少有效工作区上下文。");
    const previousContext = cloneContext(committedContext);
    pendingContext = cloneContext(context);
    const loadedTargets = loaded(targets);
    if (committedContext && contextKey(committedContext) === nextKey && isFullyConfigured(targets)) {
      return { ok: true, shortCircuited: true, failures: [], committedContext: cloneContext(committedContext) };
    }

    const failures = [];
    const attemptedTargets = [];
    for (const target of loadedTargets) {
      const entry = configured.get(target.tabId);
      if (entry?.contextKey === nextKey && entry.extensionId === target.extensionId) continue;
      try {
        attemptedTargets.push(target);
        await configure(target, context);
        recordConfigured(target.tabId, target.extensionId, context);
      } catch (error) {
        configured.delete(target.tabId);
        failures.push({ tabId: target.tabId, error });
      }
    }

    const complete = targets.length > 0 && loadedTargets.length + targets.filter(isDeferred).length === targets.length && loadedTargets.every((target) => {
      const entry = configured.get(target.tabId);
      return entry?.contextKey === nextKey && entry.extensionId === target.extensionId;
    });
    if (failures.length > 0 || !complete) {
      // Restore every target touched by the failed transition before exposing the old commit.
      const rollbackFailures = [];
      if (previousContext) {
        for (const target of attemptedTargets) {
          try {
            await configure(target, previousContext);
            recordConfigured(target.tabId, target.extensionId, previousContext);
          } catch (error) {
            configured.delete(target.tabId);
            rollbackFailures.push({ tabId: target.tabId, error, phase: "rollback" });
          }
        }
      } else {
        for (const target of attemptedTargets) configured.delete(target.tabId);
      }
      if (rollbackFailures.length > 0) {
        for (const target of loadedTargets) configured.delete(target.tabId);
        committedContext = null;
      } else {
        committedContext = previousContext;
      }
      return {
        ok: false,
        shortCircuited: false,
        failures: [...failures, ...rollbackFailures],
        committedContext: cloneContext(committedContext),
      };
    }

    committedContext = cloneContext(context);
    return { ok: true, shortCircuited: false, failures: [], committedContext: cloneContext(committedContext) };
  }

  function apply(context, targets, configure) {
    const run = applyChain.then(() => applyInternal(context, typeof targets === 'function' ? targets() : targets, configure));
    applyChain = run.catch(() => {});
    return run;
  }

  function configureCurrent(targets, configure) {
    const run = applyChain.then(() => {
      const context = committedContext || pendingContext;
      if (!context) return { ok: true, committedContext: null, failures: [] };
      return applyInternal(context, typeof targets === 'function' ? targets() : targets, configure);
    });
    applyChain = run.catch(() => {});
    return run;
  }

  function getCommittedContext() {
    return cloneContext(committedContext);
  }

  function getPendingContext() {
    return cloneContext(pendingContext);
  }

  function getState(targets = []) {
    return {
      committedContext: getCommittedContext(),
      storageConfigured: isFullyConfigured(targets),
    };
  }

  return { apply, configureCurrent, forget, getCommittedContext, getPendingContext, getState, invalidate, recordConfigured };
}

module.exports = {
  contextKey,
  createWorkspaceContextCoordinator,
  extensionLoadFailureState,
  configurationHttpResult,
  normalizeConfigurationResult,
};

import { useEffect, useState } from "react";
import { getCloudSession, isCloudAuthConfigured, subscribeCloudAuth } from "../data/cloudAuth";
import { runtimeConfig } from "../config/runtimeConfig";

export function useCloudAuth(config = runtimeConfig) {
  const configured = isCloudAuthConfigured(config);
  const [state, setState] = useState({ configured, loading: configured, session: null, user: null, error: null });

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, configured, loading: configured, error: null }));
    if (!configured) return () => { active = false; };
    getCloudSession(config)
      .then((result) => { if (active) setState({ configured: true, loading: false, ...result, error: null }); })
      .catch((error) => { if (active) setState({ configured: true, loading: false, session: null, user: null, error }); });
    const unsubscribe = subscribeCloudAuth(({ session, user }) => {
      if (active) setState({ configured: true, loading: false, session, user, error: null });
    }, config);
    return () => { active = false; unsubscribe(); };
  }, [config, configured]);

  return state;
}


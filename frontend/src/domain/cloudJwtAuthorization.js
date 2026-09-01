import { canCloudRole, isCloudRole } from "./cloudPermissions.js";
import { auditActionPermissions } from "./cloudAuthorization.js";

export class CloudJwtAuthorizationError extends Error {
  constructor(message, { code = "AUTH_REQUIRED", status = 401 } = {}) {
    super(message);
    this.name = "CloudJwtAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export function extractBearerToken(headers = {}) {
  const authorization = String(headers.authorization ?? headers.Authorization ?? "").trim();
  if (!authorization) return "";
  if (!authorization.startsWith("Bearer ")) return "";
  return authorization.slice(7).trim();
}

function claimRole(claims = {}) {
  return String(
    claims.workspaceRole
      ?? claims.app_metadata?.workspaceRole
      ?? claims.app_metadata?.role
      ?? claims.user_metadata?.workspaceRole
      ?? "",
  ).trim().toLowerCase();
}

function claimUserId(claims = {}) {
  return String(claims.sub ?? claims.userId ?? "").trim();
}

export function createTokenActorResolver({ verifyToken } = {}) {
  if (typeof verifyToken !== "function") throw new Error("JWT actor resolver 必须提供 verifyToken。 ");
  return async (token) => {
    const normalizedToken = String(token ?? "").trim();
    if (!normalizedToken) return null;
    const claims = await verifyToken(normalizedToken);
    return claimUserId(claims) || null;
  };
}

export function createClaimsAuthorizer({
  verifyToken,
  resolveMembership,
  allowClaimRoleFallback = false,
} = {}) {
  if (typeof verifyToken !== "function") throw new Error("JWT authorizer 必须提供 verifyToken。 ");
  if (typeof resolveMembership !== "function") throw new Error("JWT authorizer 必须提供 resolveMembership。 ");
  return async ({ workspaceId, token, actor, operation = "audit_events", events = [] } = {}) => {
    const normalizedToken = String(token ?? "").trim();
    if (!normalizedToken) return false;
    let claims;
    try {
      claims = await verifyToken(normalizedToken);
    } catch {
      return false;
    }
    const userId = claimUserId(claims);
    if (!userId || (actor && String(actor) !== userId)) return false;
    const membership = await resolveMembership({ userId, workspaceId, claims });
    const role = String(membership?.role ?? (allowClaimRoleFallback ? claimRole(claims) : "")).trim().toLowerCase();
    if (!membership && !allowClaimRoleFallback) return false;
    if (!isCloudRole(role) || membership?.status === "suspended") return false;
    if (["preflight", "import"].includes(operation)) return canCloudRole(role, "workspaces", "update");
    if (operation === "recovery") return canCloudRole(role, "workspaces", "read");
    if (operation === "audit_events") return events.every((event) => {
      if (event.actorIdProvided === false || !String(event.actorId ?? "").trim() || String(event.actorId).trim() !== userId) return false;
      const permissions = auditActionPermissions(event);
      return permissions.every((permission) => canCloudRole(role, permission.table, permission.operation));
    });
    return canCloudRole(role, "audit_events", "insert");
  };
}

export function createPostgresMembershipResolver({ query } = {}) {
  if (typeof query !== "function") throw new Error("PostgreSQL 成员解析器必须提供 query。 ");
  return async ({ userId, workspaceId }) => {
    const result = await query(
      "select role, status from public.workspace_members where workspace_id = $1 and user_id = $2 and status = 'active'",
      [workspaceId, userId],
    );
    return result?.rows?.[0] ?? null;
  };
}

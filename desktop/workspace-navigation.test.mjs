import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isAllowedWorkspaceUrl } = require("./workspace-navigation.cjs");

assert.equal(isAllowedWorkspaceUrl("shopeers://workstation/workspace"), true);
assert.equal(isAllowedWorkspaceUrl("https://evil.example/redirect"), false);
assert.equal(isAllowedWorkspaceUrl("http://127.0.0.1:5173/workspace", "http://127.0.0.1:5173"), true);
assert.equal(isAllowedWorkspaceUrl("http://127.0.0.1:5174/workspace", "http://127.0.0.1:5173"), false);
console.log("desktop workspace navigation tests passed");

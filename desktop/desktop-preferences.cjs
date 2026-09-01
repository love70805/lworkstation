const fs = require("node:fs");
const path = require("node:path");

const ERP_ZOOM_DEFAULT = 80;
const ERP_ZOOM_MIN = 70;
const ERP_ZOOM_MAX = 120;
const ERP_ZOOM_STEP = 10;
const PREFERENCES_FILE = "desktop-preferences.json";

function normalizeErpZoomPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return ERP_ZOOM_DEFAULT;
  const rounded = ERP_ZOOM_MIN + Math.round((number - ERP_ZOOM_MIN) / ERP_ZOOM_STEP) * ERP_ZOOM_STEP;
  return Math.min(ERP_ZOOM_MAX, Math.max(ERP_ZOOM_MIN, rounded));
}

function preferencesPath({ userDataPath }) {
  return path.join(path.resolve(userDataPath), PREFERENCES_FILE);
}

function readPreferences(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writePreferences(filePath, next, operations = fs) {
  operations.mkdirSync(path.dirname(filePath), { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const stagingPath = `${filePath}.tmp-${nonce}`;
  const backupPath = `${filePath}.bak-${nonce}`;
  operations.writeFileSync(stagingPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  try {
    operations.renameSync(stagingPath, filePath);
    return;
  } catch (initialError) {
    if (!operations.existsSync(filePath)) {
      try { operations.rmSync(stagingPath, { force: true }); } catch {}
      throw initialError;
    }
  }
  try {
    operations.renameSync(filePath, backupPath);
  } catch (backupError) {
    try { operations.rmSync(stagingPath, { force: true }); } catch {}
    throw backupError;
  }
  try {
    operations.renameSync(stagingPath, filePath);
  } catch (replacementError) {
    try {
      if (operations.existsSync(filePath)) operations.rmSync(filePath, { force: true });
      operations.renameSync(backupPath, filePath);
    } catch (restoreError) {
      replacementError.cause = restoreError;
    } finally {
      try { operations.rmSync(stagingPath, { force: true }); } catch {}
    }
    throw replacementError;
  }
  try { operations.rmSync(backupPath, { force: true }); } catch {}
}

function loadErpZoomPreference({ userDataPath }) {
  return normalizeErpZoomPercent(readPreferences(preferencesPath({ userDataPath })).erpZoomPercent);
}

function saveErpZoomPreference({ userDataPath, percent, operations = fs }) {
  const filePath = preferencesPath({ userDataPath });
  const normalized = normalizeErpZoomPercent(percent);
  writePreferences(filePath, { ...readPreferences(filePath), erpZoomPercent: normalized }, operations);
  return normalized;
}

function loadAppearancePreference({ userDataPath, fallback = "light" }) {
  const value = readPreferences(preferencesPath({ userDataPath })).appearance;
  return value === "dark" || value === "light" ? value : (fallback === "dark" ? "dark" : "light");
}

function saveAppearancePreference({ userDataPath, appearance, operations = fs }) {
  const filePath = preferencesPath({ userDataPath });
  const normalized = appearance === "dark" ? "dark" : "light";
  writePreferences(filePath, { ...readPreferences(filePath), appearance: normalized }, operations);
  return normalized;
}

module.exports = {
  ERP_ZOOM_DEFAULT,
  ERP_ZOOM_MIN,
  ERP_ZOOM_MAX,
  ERP_ZOOM_STEP,
  loadAppearancePreference,
  loadErpZoomPreference,
  normalizeErpZoomPercent,
  preferencesPath,
  writePreferences,
  saveAppearancePreference,
  saveErpZoomPreference,
};

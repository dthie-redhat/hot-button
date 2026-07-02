import { appSettings } from "./config.js";

export const STORAGE_KEYS = {
  participantId: "hotButtonParticipantId",
  username: "hotButtonUsername",
  adminUnlocked: "hotButtonAdminUnlocked"
};

export function createId(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

export function getOrCreateParticipantId() {
  const existing = localStorage.getItem(STORAGE_KEYS.participantId);
  if (existing) {
    return existing;
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : createId("participant");
  localStorage.setItem(STORAGE_KEYS.participantId, id);
  return id;
}

export function getStoredUsername() {
  return localStorage.getItem(STORAGE_KEYS.username) || "";
}

export function setStoredUsername(username) {
  localStorage.setItem(STORAGE_KEYS.username, username);
}

export function clearStoredUsername() {
  localStorage.removeItem(STORAGE_KEYS.username);
}

export function normalizeUsername(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function usernameKey(username) {
  return normalizeUsername(username).toLocaleLowerCase("en-GB");
}

export function usernameDocId(username) {
  return encodeURIComponent(usernameKey(username));
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  const min = appSettings.usernameMinLength;
  const max = appSettings.usernameMaxLength;

  if (username.length < min) {
    return { ok: false, username, message: `Use at least ${min} characters.` };
  }

  if (username.length > max) {
    return { ok: false, username, message: `Use ${max} characters or fewer.` };
  }

  if (!/^[A-Za-z0-9 ._-]+$/.test(username)) {
    return {
      ok: false,
      username,
      message: "Use only letters, numbers, spaces, dots, hyphens, or underscores."
    };
  }

  return { ok: true, username };
}

export function timestampToMillis(value) {
  return value && typeof value.toMillis === "function" ? value.toMillis() : null;
}

export function getElapsedMs(press, game) {
  const pressedAt = timestampToMillis(press?.pressedAt);
  const roundStartedAt = timestampToMillis(press?.roundStartedAt || game?.roundStartedAt);

  if (pressedAt === null || roundStartedAt === null) {
    return null;
  }

  return Math.max(0, pressedAt - roundStartedAt);
}

export function formatElapsed(ms) {
  if (ms === null || Number.isNaN(ms)) {
    return "Syncing";
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  return `${(ms / 1000).toFixed(2)} s`;
}

export function sortPresses(presses, game) {
  return [...presses].sort((a, b) => {
    const aElapsed = getElapsedMs(a, game);
    const bElapsed = getElapsedMs(b, game);
    const aTime = aElapsed === null ? Number.MAX_SAFE_INTEGER : aElapsed;
    const bTime = bElapsed === null ? Number.MAX_SAFE_INTEGER : bElapsed;

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    return String(a.username).localeCompare(String(b.username));
  });
}

export function setElementHidden(element, hidden) {
  if (element) {
    element.hidden = hidden;
  }
}

export async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function getPageUrl(pageName) {
  return new URL(pageName, window.location.href).href;
}

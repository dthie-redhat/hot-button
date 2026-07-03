import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getToken,
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig } from "./config.js";

const requiredFirebaseFields = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
  "databaseURL"
];

function isMissingConfigValue(value) {
  return !value || String(value).includes("YOUR_");
}

export const missingFirebaseFields = requiredFirebaseFields.filter((field) =>
  isMissingConfigValue(firebaseConfig[field])
);

export const firebaseIsConfigured = missingFirebaseFields.length === 0;

export const firebaseApp = firebaseIsConfigured ? initializeApp(firebaseConfig) : null;
export const appCheckRecaptchaSiteKey = firebaseConfig.appCheckRecaptchaSiteKey || "";
export const appCheckIsConfigured =
  firebaseIsConfigured && !isMissingConfigValue(appCheckRecaptchaSiteKey);

export function isLocalDevelopmentHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(globalThis.location?.hostname);
}

if (appCheckIsConfigured && isLocalDevelopmentHost()) {
  globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN =
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN || true;
}

export const appCheck =
  firebaseApp && appCheckIsConfigured
    ? initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaV3Provider(appCheckRecaptchaSiteKey),
        isTokenAutoRefreshEnabled: true
      })
    : null;

export const db = firebaseApp ? getDatabase(firebaseApp) : null;

function appCheckFailureMessage() {
  const localHelp = isLocalDevelopmentHost()
    ? " For local testing, add the App Check debug token from the browser console in Firebase Console."
    : "";

  return `Firebase App Check could not verify this browser. Check that the reCAPTCHA v3 site key is registered in Firebase App Check and that this domain is allowed.${localHelp}`;
}

export async function verifyAppCheck(timeoutMs = 8000) {
  if (!appCheck) {
    return;
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(appCheckFailureMessage()));
    }, timeoutMs);
  });

  try {
    await Promise.race([getToken(appCheck, false), timeoutPromise]);
  } catch (error) {
    console.warn("Firebase App Check verification failed.", error);
    throw new Error(appCheckFailureMessage());
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
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

function isLocalDevelopmentHost() {
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

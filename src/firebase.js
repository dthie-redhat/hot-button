import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const requiredFirebaseFields = ["apiKey", "authDomain", "projectId", "appId"];

function isMissingConfigValue(value) {
  return !value || String(value).includes("YOUR_");
}

export const missingFirebaseFields = requiredFirebaseFields.filter((field) =>
  isMissingConfigValue(firebaseConfig[field])
);

export const firebaseIsConfigured = missingFirebaseFields.length === 0;

export const firebaseApp = firebaseIsConfigured ? initializeApp(firebaseConfig) : null;
export const db = firebaseApp ? getFirestore(firebaseApp) : null;


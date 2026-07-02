import { appSettings } from "./config.js";
import { firebaseIsConfigured } from "./firebase.js";
import { renderPressList, getGameStateLabel } from "./render.js";
import {
  getPageUrl,
  setElementHidden,
  sha256Hex,
  STORAGE_KEYS
} from "./utils.js";
import {
  deleteAllData,
  disableRound,
  enableRound,
  resetRound,
  subscribeGame,
  subscribePresses
} from "./store.js";

const elements = {
  configWarning: document.querySelector("[data-config-warning]"),
  loginPanel: document.getElementById("loginPanel"),
  loginForm: document.getElementById("loginForm"),
  passcodeInput: document.getElementById("passcodeInput"),
  loginError: document.getElementById("loginError"),
  dashboard: document.getElementById("adminDashboard"),
  gameStateText: document.getElementById("gameStateText"),
  roundNumberText: document.getElementById("roundNumberText"),
  responseCountText: document.getElementById("responseCountText"),
  enableButton: document.getElementById("enableButton"),
  disableButton: document.getElementById("disableButton"),
  resetRoundButton: document.getElementById("resetRoundButton"),
  deleteAllButton: document.getElementById("deleteAllButton"),
  participantUrl: document.getElementById("participantUrl"),
  displayUrl: document.getElementById("displayUrl"),
  copyParticipantUrl: document.getElementById("copyParticipantUrl"),
  copyDisplayUrl: document.getElementById("copyDisplayUrl"),
  copyStatus: document.getElementById("copyStatus"),
  syncNote: document.getElementById("syncNote"),
  pressList: document.getElementById("pressList")
};

let currentGame = null;
let currentPresses = [];
let gameUnsubscribe = null;
let pressesUnsubscribe = null;

function isUnlocked() {
  return sessionStorage.getItem(STORAGE_KEYS.adminUnlocked) === "true";
}

function setUnlocked(value) {
  if (value) {
    sessionStorage.setItem(STORAGE_KEYS.adminUnlocked, "true");
  } else {
    sessionStorage.removeItem(STORAGE_KEYS.adminUnlocked);
  }
}

function renderAdmin() {
  elements.gameStateText.textContent = getGameStateLabel(currentGame);
  elements.roundNumberText.textContent = String(currentGame?.roundNumber || 1);
  elements.responseCountText.textContent = String(currentPresses.length);

  const isOpen = Boolean(currentGame?.isButtonEnabled);
  elements.enableButton.disabled = isOpen;
  elements.disableButton.disabled = !isOpen;
  elements.resetRoundButton.disabled = false;
  elements.deleteAllButton.disabled = false;

  renderPressList(elements.pressList, currentPresses, currentGame, {
    emptyMessage: isOpen ? "No presses yet." : "No responses in this round."
  });
}

function setPressesSubscription(roundId) {
  if (pressesUnsubscribe) {
    pressesUnsubscribe();
    pressesUnsubscribe = null;
  }

  currentPresses = [];

  if (!roundId) {
    renderAdmin();
    return;
  }

  pressesUnsubscribe = subscribePresses(
    roundId,
    (presses) => {
      currentPresses = presses;
      elements.syncNote.textContent = "Live updates connected.";
      renderAdmin();
    },
    () => {
      elements.syncNote.textContent = "Unable to load responses.";
    }
  );
}

async function showDashboard() {
  setElementHidden(elements.loginPanel, true);
  setElementHidden(elements.dashboard, false);

  elements.participantUrl.textContent = getPageUrl("index.html");
  elements.displayUrl.textContent = getPageUrl("display.html");

  gameUnsubscribe = await subscribeGame(
    (game) => {
      const previousRoundId = currentGame?.roundId;
      currentGame = game;

      if (game?.roundId !== previousRoundId) {
        setPressesSubscription(game?.roundId);
      }

      renderAdmin();
    },
    () => {
      elements.syncNote.textContent = "Unable to connect to the game state.";
    }
  );
}

function showLogin() {
  setElementHidden(elements.loginPanel, false);
  setElementHidden(elements.dashboard, true);
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
  elements.copyStatus.textContent = "Copied.";
  window.setTimeout(() => {
    elements.copyStatus.textContent = "";
  }, 1600);
}

async function runAdminAction(button, action, workingText) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = workingText;

  try {
    await action();
  } catch (error) {
    elements.syncNote.textContent = error.message || "Action failed.";
  } finally {
    button.textContent = originalText;
    renderAdmin();
  }
}

async function start() {
  if (!firebaseIsConfigured) {
    setElementHidden(elements.configWarning, false);
    setElementHidden(elements.loginPanel, true);
    setElementHidden(elements.dashboard, true);
    return;
  }

  if (isUnlocked()) {
    await showDashboard();
  } else {
    showLogin();
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setElementHidden(elements.loginError, true);

  const enteredHash = await sha256Hex(elements.passcodeInput.value);

  if (enteredHash !== appSettings.adminPasscodeSha256) {
    elements.loginError.textContent = "Passcode not recognised.";
    setElementHidden(elements.loginError, false);
    return;
  }

  setUnlocked(true);
  await showDashboard();
});

elements.enableButton.addEventListener("click", () => {
  runAdminAction(elements.enableButton, enableRound, "Opening...");
});

elements.disableButton.addEventListener("click", () => {
  runAdminAction(elements.disableButton, disableRound, "Disabling...");
});

elements.resetRoundButton.addEventListener("click", () => {
  const confirmed = window.confirm("Reset this round and clear the visible response list?");

  if (confirmed) {
    runAdminAction(elements.resetRoundButton, resetRound, "Resetting...");
  }
});

elements.deleteAllButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "Delete all participant names, username reservations, rounds, and press history?"
  );

  if (confirmed) {
    runAdminAction(elements.deleteAllButton, deleteAllData, "Deleting...");
  }
});

elements.copyParticipantUrl.addEventListener("click", () => {
  copyText(elements.participantUrl.textContent);
});

elements.copyDisplayUrl.addEventListener("click", () => {
  copyText(elements.displayUrl.textContent);
});

window.addEventListener("pagehide", () => {
  gameUnsubscribe?.();
  pressesUnsubscribe?.();
});

start();


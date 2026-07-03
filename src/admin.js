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
  resetGameToStart,
  resetRound,
  subscribeConnection,
  subscribeGame,
  subscribeParticipants,
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
  toggleRoundButton: document.getElementById("toggleRoundButton"),
  toggleRoundButtonLabel: document.getElementById("toggleRoundButtonLabel"),
  resetRoundButton: document.getElementById("resetRoundButton"),
  resetGameButton: document.getElementById("resetGameButton"),
  deleteAllButton: document.getElementById("deleteAllButton"),
  participantUrl: document.getElementById("participantUrl"),
  displayUrl: document.getElementById("displayUrl"),
  copyParticipantUrl: document.getElementById("copyParticipantUrl"),
  copyDisplayUrl: document.getElementById("copyDisplayUrl"),
  copyStatus: document.getElementById("copyStatus"),
  syncNote: document.getElementById("syncNote"),
  pressList: document.getElementById("pressList"),
  participantCountText: document.getElementById("participantCountText"),
  participantList: document.getElementById("participantList")
};

let currentGame = null;
let currentPresses = [];
let currentParticipants = [];
let isConnected = null;
let gameUnsubscribe = null;
let pressesUnsubscribe = null;
let participantsUnsubscribe = null;
let connectionUnsubscribe = null;

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
  const controlsDisabled = !currentGame || isConnected !== true;
  elements.toggleRoundButtonLabel.textContent = isOpen ? "Disable" : "Enable";
  elements.toggleRoundButton.classList.toggle("is-live", isOpen);
  elements.toggleRoundButton.disabled = controlsDisabled;
  elements.resetRoundButton.disabled = controlsDisabled;
  elements.resetGameButton.disabled = controlsDisabled;
  elements.deleteAllButton.disabled = controlsDisabled;

  if (isConnected === false) {
    elements.syncNote.textContent = "Reconnecting to Firebase. Controls are paused.";
  } else if (isConnected === null) {
    elements.syncNote.textContent = "Connecting to Firebase.";
  }

  renderPressList(elements.pressList, currentPresses, currentGame, {
    emptyMessage: isOpen ? "No presses yet." : "No responses in this round."
  });

  renderParticipantList();
}

function renderParticipantList() {
  const sortedParticipants = [...currentParticipants].sort((a, b) =>
    String(a.username || "").localeCompare(String(b.username || ""), undefined, {
      sensitivity: "base"
    })
  );
  const count = sortedParticipants.length;

  elements.participantCountText.textContent =
    count === 1 ? "1 participant" : `${count} participants`;
  elements.participantList.replaceChildren();

  if (count === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty-list";
    emptyItem.textContent = "No participants registered yet.";
    elements.participantList.append(emptyItem);
    return;
  }

  sortedParticipants.forEach((participant) => {
    const item = document.createElement("li");
    item.className = "participant-row";

    const name = document.createElement("span");
    name.className = "participant-name";
    name.textContent = participant.username || "Unknown";

    item.append(name);
    elements.participantList.append(item);
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

function setParticipantsSubscription() {
  if (participantsUnsubscribe) {
    participantsUnsubscribe();
  }

  participantsUnsubscribe = subscribeParticipants(
    (participants) => {
      currentParticipants = participants;
      renderAdmin();
    },
    () => {
      elements.participantCountText.textContent = "Unable to load participants.";
    }
  );
}

async function showDashboard() {
  setElementHidden(elements.loginPanel, true);
  setElementHidden(elements.dashboard, false);

  elements.participantUrl.textContent = getPageUrl("index.html");
  elements.displayUrl.textContent = getPageUrl("display.html");

  connectionUnsubscribe = subscribeConnection(
    (connected) => {
      isConnected = connected;
      elements.syncNote.textContent = connected
        ? "Live updates connected."
        : "Reconnecting to Firebase. Controls are paused.";
      renderAdmin();
    },
    () => {
      isConnected = false;
      elements.syncNote.textContent = "Unable to check the Firebase connection.";
      renderAdmin();
    }
  );

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

  setParticipantsSubscription();
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

async function withActionTimeout(actionPromise, timeoutMs = 8000) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error("Firebase did not confirm that action. Check the connection and try again."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([actionPromise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function runAdminAction(button, action, workingText) {
  if (isConnected !== true) {
    elements.syncNote.textContent = "Firebase is reconnecting. Try again once connected.";
    renderAdmin();
    return;
  }

  const label = button.querySelector(".hot-button-label");
  const originalText = label ? label.textContent : button.textContent;
  button.disabled = true;

  if (label) {
    label.textContent = workingText;
  } else {
    button.textContent = workingText;
  }

  try {
    await withActionTimeout(action());
    elements.syncNote.textContent = "Action confirmed.";
  } catch (error) {
    elements.syncNote.textContent = error.message || "Action failed.";
  } finally {
    if (label) {
      label.textContent = originalText;
    } else {
      button.textContent = originalText;
    }
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

elements.toggleRoundButton.addEventListener("click", () => {
  const isOpen = Boolean(currentGame?.isButtonEnabled);
  const action = isOpen ? disableRound : enableRound;
  const workingText = isOpen ? "Disabling..." : "Enabling...";
  runAdminAction(elements.toggleRoundButton, action, workingText);
});

elements.resetRoundButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "Clear this round's responses without changing the round number?"
  );

  if (confirmed) {
    runAdminAction(elements.resetRoundButton, resetRound, "Resetting...");
  }
});

elements.resetGameButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "Reset the game back to Round 1 while preserving participants and stored history?"
  );

  if (confirmed) {
    runAdminAction(elements.resetGameButton, resetGameToStart, "Resetting...");
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
  connectionUnsubscribe?.();
  gameUnsubscribe?.();
  pressesUnsubscribe?.();
  participantsUnsubscribe?.();
});

start();

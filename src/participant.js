import { firebaseIsConfigured, verifyAppCheck } from "./firebase.js";
import {
  clearStoredUsername,
  formatElapsed,
  getElapsedMs,
  getOrCreateParticipantId,
  getStoredUsername,
  setElementHidden,
  setStoredUsername
} from "./utils.js";
import {
  HotButtonError,
  pressButton,
  registerParticipant,
  subscribeConnection,
  subscribeGame,
  subscribeParticipant,
  subscribeParticipantPress
} from "./store.js";

const participantId = getOrCreateParticipantId();

const elements = {
  configWarning: document.querySelector("[data-config-warning]"),
  registrationPanel: document.getElementById("registrationPanel"),
  registrationForm: document.getElementById("registrationForm"),
  usernameInput: document.getElementById("usernameInput"),
  registrationError: document.getElementById("registrationError"),
  saveUsernameButton: document.getElementById("saveUsernameButton"),
  cancelUsernameButton: document.getElementById("cancelUsernameButton"),
  buttonPanel: document.getElementById("buttonPanel"),
  usernameLabel: document.getElementById("usernameLabel"),
  changeUsernameButton: document.getElementById("changeUsernameButton"),
  roundLabel: document.getElementById("roundLabel"),
  hotButton: document.getElementById("hotButton"),
  buttonStateMessage: document.getElementById("buttonStateMessage")
};

let currentGame = null;
let currentParticipant = null;
let currentPress = null;
let isConnected = null;
let isRegistering = false;
let isPressing = false;
let isPressAnimationActive = false;
let transientButtonMessage = "";
let gameUnsubscribe = null;
let participantUnsubscribe = null;
let pressUnsubscribe = null;
let connectionUnsubscribe = null;
let pressAnimationTimeout = null;

async function withFirebaseTimeout(actionPromise, timeoutMs = 10000) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error("Firebase did not confirm that request. Check the connection and try again."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([actionPromise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function showRegistration(message = "") {
  elements.registrationError.textContent = message;
  setElementHidden(elements.registrationError, !message);
  elements.usernameInput.value = currentParticipant?.username || getStoredUsername();
  elements.cancelUsernameButton.hidden = !currentParticipant;
  setElementHidden(elements.registrationPanel, false);
  setElementHidden(elements.buttonPanel, true);
  elements.usernameInput.focus();
}

function showButtonPanel() {
  setElementHidden(elements.registrationPanel, true);
  setElementHidden(elements.buttonPanel, false);
}

function setRegistrationBusy(isBusy) {
  isRegistering = isBusy;
  elements.saveUsernameButton.disabled = isBusy;
  elements.saveUsernameButton.textContent = isBusy ? "Saving..." : "Save name";
}

function renderButtonState() {
  if (!currentParticipant) {
    showRegistration();
    return;
  }

  showButtonPanel();
  elements.usernameLabel.textContent = currentParticipant.username;
  elements.roundLabel.textContent = `Round ${currentGame?.roundNumber || 1}`;

  const roundIsOpen = Boolean(currentGame?.isButtonEnabled && currentGame?.roundStartedAt);
  const hasPressed = Boolean(currentPress);
  const canPress = isConnected === true && roundIsOpen && !hasPressed && !isPressing;
  elements.hotButton.disabled = !canPress;
  elements.hotButton.classList.toggle("is-live", isConnected === true && roundIsOpen && !hasPressed);
  elements.hotButton.classList.toggle("is-registering", isPressAnimationActive);

  if (transientButtonMessage) {
    elements.buttonStateMessage.textContent = transientButtonMessage;
    return;
  }

  if (isConnected !== true) {
    elements.buttonStateMessage.textContent =
      isConnected === false
        ? "Reconnecting to the game."
        : "Connecting to the game.";
    return;
  }

  if (!roundIsOpen) {
    elements.buttonStateMessage.textContent = "Waiting for the host to open the button.";
    return;
  }

  if (hasPressed) {
    const elapsed = formatElapsed(getElapsedMs(currentPress, currentGame));
    elements.buttonStateMessage.textContent = `Registered at ${elapsed}. Waiting for the next round.`;
    return;
  }

  elements.buttonStateMessage.textContent = isPressing ? "Registering your press..." : "Button is live.";
}

function setPressSubscription(roundId) {
  if (pressUnsubscribe) {
    pressUnsubscribe();
    pressUnsubscribe = null;
  }

  currentPress = null;

  if (!roundId || !currentParticipant) {
    renderButtonState();
    return;
  }

  pressUnsubscribe = subscribeParticipantPress(
    roundId,
    participantId,
    (press) => {
      currentPress = press;
      isPressing = false;
      transientButtonMessage = "";
      renderButtonState();
    },
    () => {
      elements.buttonStateMessage.textContent = "Unable to check your press status.";
    }
  );
}

function setParticipantSubscription() {
  if (participantUnsubscribe) {
    participantUnsubscribe();
  }

  participantUnsubscribe = subscribeParticipant(
    participantId,
    (participant) => {
      currentParticipant = participant;
      if (participant?.username) {
        setStoredUsername(participant.username);
        setPressSubscription(currentGame?.roundId);
      }
      renderButtonState();
    },
    () => {
      showRegistration("Unable to load your participant record.");
    }
  );
}

async function saveUsername(username, options = {}) {
  setRegistrationBusy(true);
  setElementHidden(elements.registrationError, true);

  try {
    await verifyAppCheck();
    const savedUsername = await withFirebaseTimeout(
      registerParticipant(participantId, username)
    );
    setStoredUsername(savedUsername);
    setParticipantSubscription();
    showButtonPanel();
  } catch (error) {
    if (options.quiet && error instanceof HotButtonError && error.code === "duplicate-username") {
      clearStoredUsername();
    }

    showRegistration(error.message || "Unable to save that username.");
  } finally {
    setRegistrationBusy(false);
  }
}

async function start() {
  if (!firebaseIsConfigured) {
    setElementHidden(elements.configWarning, false);
    setElementHidden(elements.registrationPanel, true);
    setElementHidden(elements.buttonPanel, true);
    return;
  }

  try {
    await verifyAppCheck();
  } catch (error) {
    showRegistration(error.message || "Unable to verify this browser.");
    return;
  }

  connectionUnsubscribe = subscribeConnection(
    (connected) => {
      isConnected = connected;
      renderButtonState();
    },
    () => {
      isConnected = false;
      renderButtonState();
    }
  );

  gameUnsubscribe = await subscribeGame(
    (game) => {
      const previousRoundId = currentGame?.roundId;
      currentGame = game;

      if (game?.roundId !== previousRoundId) {
        setPressSubscription(game?.roundId);
      }

      renderButtonState();
    },
    () => {
      showRegistration("Unable to connect to the game state.");
    }
  );

  setParticipantSubscription();
  showRegistration();
}

elements.registrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveUsername(elements.usernameInput.value);
});

elements.cancelUsernameButton.addEventListener("click", () => {
  renderButtonState();
});

elements.changeUsernameButton.addEventListener("click", () => {
  showRegistration();
});

elements.hotButton.addEventListener("click", async () => {
  const roundIsOpen = Boolean(currentGame?.isButtonEnabled && currentGame?.roundStartedAt);

  if (isConnected !== true || !roundIsOpen || currentPress || isPressing) {
    return;
  }

  isPressing = true;
  isPressAnimationActive = true;
  transientButtonMessage = "";
  renderButtonState();

  window.clearTimeout(pressAnimationTimeout);
  pressAnimationTimeout = window.setTimeout(() => {
    isPressAnimationActive = false;
    renderButtonState();
  }, 420);

  try {
    await pressButton(participantId);
  } catch (error) {
    isPressing = false;
    isPressAnimationActive = false;
    transientButtonMessage = error.message || "Unable to register your press.";
    renderButtonState();
  }
});

window.addEventListener("pagehide", () => {
  connectionUnsubscribe?.();
  gameUnsubscribe?.();
  participantUnsubscribe?.();
  pressUnsubscribe?.();
  window.clearTimeout(pressAnimationTimeout);
});

start();

import { firebaseIsConfigured } from "./firebase.js";
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
let isRegistering = false;
let isPressing = false;
let transientButtonMessage = "";
let gameUnsubscribe = null;
let participantUnsubscribe = null;
let pressUnsubscribe = null;

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
  const canPress = roundIsOpen && !hasPressed && !isPressing;
  elements.hotButton.disabled = !canPress;
  elements.hotButton.classList.toggle("is-live", roundIsOpen && !hasPressed);
  elements.hotButton.classList.toggle("is-pressed", hasPressed);

  if (transientButtonMessage) {
    elements.buttonStateMessage.textContent = transientButtonMessage;
    return;
  }

  if (!roundIsOpen) {
    elements.buttonStateMessage.textContent = "Waiting for the host to open the button.";
    return;
  }

  if (hasPressed) {
    const elapsed = formatElapsed(getElapsedMs(currentPress, currentGame));
    elements.buttonStateMessage.textContent = `Registered at ${elapsed}.`;
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
    const savedUsername = await registerParticipant(participantId, username);
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

  const cachedUsername = getStoredUsername();

  if (cachedUsername) {
    await saveUsername(cachedUsername, { quiet: true });
  } else {
    showRegistration();
  }
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

  if (!roundIsOpen || currentPress || isPressing) {
    return;
  }

  isPressing = true;
  transientButtonMessage = "";
  renderButtonState();

  try {
    await pressButton(participantId);
  } catch (error) {
    isPressing = false;
    transientButtonMessage = error.message || "Unable to register your press.";
    renderButtonState();
  }
});

window.addEventListener("pagehide", () => {
  gameUnsubscribe?.();
  participantUnsubscribe?.();
  pressUnsubscribe?.();
});

start();

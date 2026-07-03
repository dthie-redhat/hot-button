import { firebaseIsConfigured } from "./firebase.js";
import { renderPressList, getGameStateLabel } from "./render.js";
import { getPageUrl, setElementHidden } from "./utils.js";
import { subscribeConnection, subscribeGame, subscribePresses } from "./store.js";

const elements = {
  configWarning: document.querySelector("[data-config-warning]"),
  board: document.getElementById("displayBoard"),
  participantUrl: document.getElementById("displayParticipantUrl"),
  stateText: document.getElementById("displayStateText"),
  roundText: document.getElementById("displayRoundText"),
  footer: document.getElementById("displayFooter"),
  pressList: document.getElementById("displayPressList")
};

let currentGame = null;
let currentPresses = [];
let isConnected = null;
let gameUnsubscribe = null;
let pressesUnsubscribe = null;
let connectionUnsubscribe = null;

function renderDisplay() {
  elements.stateText.textContent = getGameStateLabel(currentGame);
  elements.roundText.textContent = `Round ${currentGame?.roundNumber || 1}`;

  if (isConnected !== true) {
    elements.footer.textContent =
      isConnected === false
        ? "Reconnecting to live updates."
        : "Connecting to live updates.";
  } else if (currentGame?.isButtonEnabled) {
    elements.footer.textContent = currentPresses.length
      ? "Live response order."
      : "Button is open.";
  } else {
    elements.footer.textContent = currentPresses.length
      ? "Round closed."
      : "Waiting for the host to open the button.";
  }

  renderPressList(elements.pressList, currentPresses, currentGame, {
    emptyMessage: currentGame?.isButtonEnabled ? "Waiting for the first press." : "No responses yet."
  });
}

function setPressesSubscription(roundId) {
  if (pressesUnsubscribe) {
    pressesUnsubscribe();
    pressesUnsubscribe = null;
  }

  currentPresses = [];

  if (!roundId) {
    renderDisplay();
    return;
  }

  pressesUnsubscribe = subscribePresses(
    roundId,
    (presses) => {
      currentPresses = presses;
      renderDisplay();
    },
    () => {
      elements.footer.textContent = "Unable to load live responses.";
    }
  );
}

async function start() {
  const participantUrl = getPageUrl("index.html");
  elements.participantUrl.textContent = participantUrl;

  if (!firebaseIsConfigured) {
    setElementHidden(elements.configWarning, false);
    setElementHidden(elements.board, true);
    return;
  }

  connectionUnsubscribe = subscribeConnection(
    (connected) => {
      isConnected = connected;
      renderDisplay();
    },
    () => {
      isConnected = false;
      renderDisplay();
    }
  );

  gameUnsubscribe = await subscribeGame(
    (game) => {
      const previousRoundId = currentGame?.roundId;
      currentGame = game;

      if (game?.roundId !== previousRoundId) {
        setPressesSubscription(game?.roundId);
      }

      renderDisplay();
    },
    () => {
      elements.footer.textContent = "Unable to connect to the game state.";
    }
  );
}

window.addEventListener("pagehide", () => {
  connectionUnsubscribe?.();
  gameUnsubscribe?.();
  pressesUnsubscribe?.();
});

start();

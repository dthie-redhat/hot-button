import { formatElapsed, getElapsedMs, sortPresses } from "./utils.js";

function createEmptyMessage(message, className = "empty-list") {
  const item = document.createElement("li");
  item.className = className;
  item.textContent = message;
  return item;
}

export function renderPressList(container, presses, game, options = {}) {
  const orderedPresses = sortPresses(presses, game);
  const emptyMessage = options.emptyMessage || "No presses yet.";

  container.replaceChildren();

  if (orderedPresses.length === 0) {
    container.append(createEmptyMessage(emptyMessage));
    return;
  }

  orderedPresses.forEach((press, index) => {
    const item = document.createElement("li");
    item.className = "press-row";

    const rank = document.createElement("span");
    rank.className = "press-rank";
    rank.textContent = String(index + 1);

    const name = document.createElement("span");
    name.className = "press-name";
    name.textContent = press.username || "Unknown";

    const time = document.createElement("span");
    time.className = "press-time";
    time.textContent = formatElapsed(getElapsedMs(press, game));

    item.append(rank, name, time);
    container.append(item);
  });
}

export function getGameStateLabel(game) {
  if (!game) {
    return "Loading";
  }

  return game.isButtonEnabled ? "Open" : "Waiting";
}


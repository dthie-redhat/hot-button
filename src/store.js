import {
  get,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  update
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { db } from "./firebase.js";
import {
  createId,
  usernameDocId,
  usernameKey,
  validateUsername
} from "./utils.js";

export class HotButtonError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HotButtonError";
    this.code = code;
  }
}

function requireDb() {
  if (!db) {
    throw new HotButtonError("firebase-not-configured", "Firebase is not configured.");
  }

  return db;
}

function rootRef(database = requireDb()) {
  return ref(database);
}

function gameRef(database = requireDb()) {
  return ref(database, "settings/game");
}

function participantRef(participantId, database = requireDb()) {
  return ref(database, `participants/${participantId}`);
}

function pressRef(roundId, participantId, database = requireDb()) {
  return ref(database, `rounds/${roundId}/presses/${participantId}`);
}

function now() {
  return serverTimestamp();
}

function cleanGamePayload(roundId, roundNumber, revision = 0) {
  return {
    isButtonEnabled: false,
    roundId,
    roundNumber,
    roundStartedAt: null,
    revision,
    updatedAt: now()
  };
}

function cleanRoundPayload(roundId, roundNumber) {
  return {
    roundId,
    roundNumber,
    status: "waiting",
    startedAt: null,
    createdAt: now(),
    updatedAt: now()
  };
}

function valueWithId(id, value) {
  return value ? { id, ...value } : null;
}

function collectionValues(value) {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).map(([id, data]) => ({ id, ...data }));
}

function nextRevision(game) {
  return Number(game?.revision || 0) + 1;
}

function initialSessionPayload(roundId = createId("round")) {
  return {
    "settings/game": {
      ...cleanGamePayload(roundId, 1, 0),
      createdAt: now()
    },
    [`rounds/${roundId}`]: cleanRoundPayload(roundId, 1)
  };
}

export async function ensureGameDocument() {
  const database = requireDb();
  const snapshot = await get(gameRef(database));

  if (snapshot.exists()) {
    return valueWithId("game", snapshot.val());
  }

  const roundId = createId("round");
  await update(rootRef(database), initialSessionPayload(roundId));

  return {
    id: "game",
    isButtonEnabled: false,
    roundId,
    roundNumber: 1,
    roundStartedAt: null,
    revision: 0
  };
}

export async function subscribeGame(onNext, onError) {
  const database = requireDb();
  await ensureGameDocument();

  return onValue(
    gameRef(database),
    (snapshot) => onNext(valueWithId("game", snapshot.val())),
    onError
  );
}

export function subscribeConnection(onNext, onError) {
  const database = requireDb();

  return onValue(
    ref(database, ".info/connected"),
    (snapshot) => onNext(Boolean(snapshot.val())),
    onError
  );
}

export function subscribeParticipant(participantId, onNext, onError) {
  const database = requireDb();

  return onValue(
    participantRef(participantId, database),
    (snapshot) => onNext(valueWithId(participantId, snapshot.val())),
    onError
  );
}

export function subscribeParticipantPress(roundId, participantId, onNext, onError) {
  const database = requireDb();

  return onValue(
    pressRef(roundId, participantId, database),
    (snapshot) => onNext(valueWithId(participantId, snapshot.val())),
    onError
  );
}

export function subscribePresses(roundId, onNext, onError) {
  const database = requireDb();

  return onValue(
    ref(database, `rounds/${roundId}/presses`),
    (snapshot) => onNext(collectionValues(snapshot.val())),
    onError
  );
}

export function subscribeParticipants(onNext, onError) {
  const database = requireDb();

  return onValue(
    ref(database, "participants"),
    (snapshot) => onNext(collectionValues(snapshot.val())),
    onError
  );
}

export async function registerParticipant(participantId, rawUsername) {
  const database = requireDb();
  const validation = validateUsername(rawUsername);

  if (!validation.ok) {
    throw new HotButtonError("invalid-username", validation.message);
  }

  const username = validation.username;
  const nextUsernameKey = usernameKey(username);
  const nextUsernameDocId = usernameDocId(username);
  const result = await runTransaction(
    rootRef(database),
    (session) => {
      const nextSession = session || {};
      const participants = { ...(nextSession.participants || {}) };
      const usernames = { ...(nextSession.usernames || {}) };
      const participant = participants[participantId] || null;
      const reservation = usernames[nextUsernameDocId] || null;

      if (reservation?.participantId && reservation.participantId !== participantId) {
        return;
      }

      const oldUsernameDocId = participant?.usernameDocId;

      if (oldUsernameDocId && oldUsernameDocId !== nextUsernameDocId) {
        const oldReservation = usernames[oldUsernameDocId];

        if (!oldReservation || oldReservation.participantId === participantId) {
          delete usernames[oldUsernameDocId];
        }
      }

      participants[participantId] = {
        participantId,
        username,
        usernameKey: nextUsernameKey,
        usernameDocId: nextUsernameDocId,
        createdAt: participant?.createdAt || now(),
        updatedAt: now()
      };

      usernames[nextUsernameDocId] = {
        participantId,
        username,
        usernameKey: nextUsernameKey,
        createdAt: reservation?.createdAt || now(),
        updatedAt: now()
      };

      return {
        ...nextSession,
        participants,
        usernames
      };
    },
    { applyLocally: false }
  );

  if (!result.committed) {
    throw new HotButtonError("duplicate-username", "That username is already in use.");
  }

  return username;
}

export async function pressButton(participantId) {
  const database = requireDb();
  const result = await runTransaction(
    rootRef(database),
    (session) => {
      if (!session?.settings?.game) {
        return;
      }

      const game = session.settings.game;

      if (!game.isButtonEnabled || !game.roundId || !game.roundStartedAt) {
        return;
      }

      const participant = session.participants?.[participantId];

      if (!participant) {
        return;
      }

      const rounds = { ...(session.rounds || {}) };
      const round = {
        ...(rounds[game.roundId] || {
          roundId: game.roundId,
          roundNumber: game.roundNumber || null
        })
      };
      const presses = { ...(round.presses || {}) };

      if (presses[participantId]) {
        return;
      }

      presses[participantId] = {
        participantId,
        username: participant.username,
        usernameKey: participant.usernameKey,
        roundId: game.roundId,
        roundNumber: game.roundNumber || null,
        roundStartedAt: game.roundStartedAt,
        pressedAt: now(),
        createdAt: now()
      };

      round.presses = presses;
      round.updatedAt = now();
      rounds[game.roundId] = round;

      return {
        ...session,
        rounds
      };
    },
    { applyLocally: false }
  );

  if (result.committed) {
    return;
  }

  const gameSnapshot = await get(gameRef(database));
  const game = gameSnapshot.exists() ? gameSnapshot.val() : null;

  if (!game || !game.isButtonEnabled || !game.roundId || !game.roundStartedAt) {
    throw new HotButtonError("round-closed", "The button is not open yet.");
  }

  const participantSnapshot = await get(participantRef(participantId, database));

  if (!participantSnapshot.exists()) {
    throw new HotButtonError("not-registered", "Choose a username before pressing.");
  }

  const pressSnapshot = await get(pressRef(game.roundId, participantId, database));

  if (pressSnapshot.exists()) {
    throw new HotButtonError("already-pressed", "Your press is already registered.");
  }

  throw new HotButtonError("press-failed", "Unable to register your press.");
}

export async function enableRound() {
  const database = requireDb();
  const game = await ensureGameDocument();
  const needsNewRound = !game.roundId || game.roundStartedAt;
  const roundId = needsNewRound ? createId("round") : game.roundId;
  const roundNumber = needsNewRound
    ? Number(game.roundNumber || 0) + 1
    : Number(game.roundNumber || 1);
  const revision = nextRevision(game);

  if (game.isButtonEnabled) {
    return;
  }

  await update(rootRef(database), {
    [`rounds/${roundId}`]: {
      ...(needsNewRound ? cleanRoundPayload(roundId, roundNumber) : {}),
      roundId,
      roundNumber,
      status: "active",
      startedAt: now(),
      updatedAt: now()
    },
    "settings/game/isButtonEnabled": true,
    "settings/game/roundId": roundId,
    "settings/game/roundNumber": roundNumber,
    "settings/game/roundStartedAt": now(),
    "settings/game/revision": revision,
    "settings/game/updatedAt": now()
  });
}

export async function disableRound() {
  const database = requireDb();
  const game = await ensureGameDocument();
  const updates = {
    "settings/game/isButtonEnabled": false,
    "settings/game/revision": nextRevision(game),
    "settings/game/updatedAt": now()
  };

  if (game.roundId) {
    updates[`rounds/${game.roundId}/status`] = "disabled";
    updates[`rounds/${game.roundId}/updatedAt`] = now();
  }

  await update(rootRef(database), updates);
}

export async function resetRound() {
  const database = requireDb();
  const game = await ensureGameDocument();
  const roundNumber = Number(game.roundNumber || 1);
  const roundId = createId("round");

  await update(rootRef(database), {
    [`rounds/${roundId}`]: {
      ...cleanRoundPayload(roundId, roundNumber),
      resetFromRoundId: game.roundId || null
    },
    "settings/game/isButtonEnabled": false,
    "settings/game/roundId": roundId,
    "settings/game/roundNumber": roundNumber,
    "settings/game/roundStartedAt": null,
    "settings/game/revision": nextRevision(game),
    "settings/game/resetAt": now(),
    "settings/game/updatedAt": now()
  });
}

export async function resetGameToStart() {
  const database = requireDb();
  const game = await ensureGameDocument();
  const roundId = createId("round");

  await update(rootRef(database), {
    [`rounds/${roundId}`]: cleanRoundPayload(roundId, 1),
    "settings/game/isButtonEnabled": false,
    "settings/game/roundId": roundId,
    "settings/game/roundNumber": 1,
    "settings/game/roundStartedAt": null,
    "settings/game/revision": nextRevision(game),
    "settings/game/gameResetAt": now(),
    "settings/game/updatedAt": now()
  });
}

function countKeys(value) {
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

function countPresses(rounds) {
  if (!rounds || typeof rounds !== "object") {
    return 0;
  }

  return Object.values(rounds).reduce(
    (total, round) => total + countKeys(round?.presses),
    0
  );
}

export async function deleteAllData() {
  const database = requireDb();
  const snapshot = await get(rootRef(database));
  const session = snapshot.exists() ? snapshot.val() : {};
  const roundId = createId("round");
  const counts = {
    participants: countKeys(session.participants),
    usernames: countKeys(session.usernames),
    rounds: countKeys(session.rounds),
    presses: countPresses(session.rounds)
  };

  await update(rootRef(database), {
    participants: null,
    usernames: null,
    rounds: {
      [roundId]: cleanRoundPayload(roundId, 1)
    },
    "settings/game": {
      ...cleanGamePayload(roundId, 1, 0),
      createdAt: now(),
      fullResetAt: now()
    }
  });

  return counts;
}

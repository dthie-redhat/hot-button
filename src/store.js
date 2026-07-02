import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
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

function gameRef(database = requireDb()) {
  return doc(database, "settings", "game");
}

function participantRef(participantId, database = requireDb()) {
  return doc(database, "participants", participantId);
}

function usernameRef(username, database = requireDb()) {
  return doc(database, "usernames", usernameDocId(username));
}

function roundRef(roundId, database = requireDb()) {
  return doc(database, "rounds", roundId);
}

function pressRef(roundId, participantId, database = requireDb()) {
  return doc(database, "rounds", roundId, "presses", participantId);
}

function cleanGamePayload(roundId, roundNumber) {
  return {
    isButtonEnabled: false,
    roundId,
    roundNumber,
    roundStartedAt: null,
    updatedAt: serverTimestamp()
  };
}

function cleanRoundPayload(roundId, roundNumber) {
  return {
    roundId,
    roundNumber,
    status: "waiting",
    startedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function snapshotData(snapshot) {
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function ensureGameDocument() {
  const database = requireDb();
  const ref = gameRef(database);
  const snapshot = await getDoc(ref);

  if (snapshot.exists()) {
    return snapshotData(snapshot);
  }

  const roundId = createId("round");
  const batch = writeBatch(database);
  batch.set(ref, {
    ...cleanGamePayload(roundId, 1),
    createdAt: serverTimestamp()
  });
  batch.set(roundRef(roundId, database), cleanRoundPayload(roundId, 1));
  await batch.commit();

  return {
    id: "game",
    isButtonEnabled: false,
    roundId,
    roundNumber: 1,
    roundStartedAt: null
  };
}

export async function subscribeGame(onNext, onError) {
  const database = requireDb();
  await ensureGameDocument();

  return onSnapshot(
    gameRef(database),
    (snapshot) => onNext(snapshotData(snapshot)),
    onError
  );
}

export function subscribeParticipant(participantId, onNext, onError) {
  const database = requireDb();

  return onSnapshot(
    participantRef(participantId, database),
    (snapshot) => onNext(snapshotData(snapshot)),
    onError
  );
}

export function subscribeParticipantPress(roundId, participantId, onNext, onError) {
  const database = requireDb();

  return onSnapshot(
    pressRef(roundId, participantId, database),
    (snapshot) => onNext(snapshotData(snapshot)),
    onError
  );
}

export function subscribePresses(roundId, onNext, onError) {
  const database = requireDb();

  return onSnapshot(
    collection(database, "rounds", roundId, "presses"),
    (snapshot) => {
      onNext(snapshot.docs.map((pressSnapshot) => snapshotData(pressSnapshot)));
    },
    onError
  );
}

export function subscribeParticipants(onNext, onError) {
  const database = requireDb();

  return onSnapshot(
    collection(database, "participants"),
    (snapshot) => {
      onNext(snapshot.docs.map((participantSnapshot) => snapshotData(participantSnapshot)));
    },
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
  const nextUsernameRef = usernameRef(username, database);
  const nextParticipantRef = participantRef(participantId, database);

  await runTransaction(database, async (transaction) => {
    const participantSnapshot = await transaction.get(nextParticipantRef);
    const usernameSnapshot = await transaction.get(nextUsernameRef);
    const existingUsernameOwner = usernameSnapshot.exists()
      ? usernameSnapshot.data().participantId
      : null;

    if (existingUsernameOwner && existingUsernameOwner !== participantId) {
      throw new HotButtonError("duplicate-username", "That username is already in use.");
    }

    const currentParticipant = participantSnapshot.exists()
      ? participantSnapshot.data()
      : null;
    const oldUsernameDocId = currentParticipant?.usernameDocId;
    const shouldDeleteOldUsername =
      oldUsernameDocId && oldUsernameDocId !== nextUsernameDocId;
    const oldUsernameRef = shouldDeleteOldUsername
      ? doc(database, "usernames", oldUsernameDocId)
      : null;
    const oldUsernameSnapshot = oldUsernameRef
      ? await transaction.get(oldUsernameRef)
      : null;

    const participantPayload = {
      participantId,
      username,
      usernameKey: nextUsernameKey,
      usernameDocId: nextUsernameDocId,
      updatedAt: serverTimestamp()
    };

    if (!participantSnapshot.exists()) {
      participantPayload.createdAt = serverTimestamp();
    }

    transaction.set(nextParticipantRef, participantPayload, { merge: true });

    const usernamePayload = {
      participantId,
      username,
      usernameKey: nextUsernameKey,
      updatedAt: serverTimestamp()
    };

    if (!usernameSnapshot.exists()) {
      usernamePayload.createdAt = serverTimestamp();
    }

    transaction.set(nextUsernameRef, usernamePayload, { merge: true });

    if (
      oldUsernameRef &&
      (!oldUsernameSnapshot.exists() ||
        oldUsernameSnapshot.data().participantId === participantId)
    ) {
      transaction.delete(oldUsernameRef);
    }
  });

  return username;
}

export async function pressButton(participantId) {
  const database = requireDb();
  const ref = gameRef(database);

  await runTransaction(database, async (transaction) => {
    const gameSnapshot = await transaction.get(ref);
    const game = gameSnapshot.exists() ? gameSnapshot.data() : null;

    if (!game || !game.isButtonEnabled || !game.roundId || !game.roundStartedAt) {
      throw new HotButtonError("round-closed", "The button is not open yet.");
    }

    const currentParticipantRef = participantRef(participantId, database);
    const participantSnapshot = await transaction.get(currentParticipantRef);

    if (!participantSnapshot.exists()) {
      throw new HotButtonError("not-registered", "Choose a username before pressing.");
    }

    const currentPressRef = pressRef(game.roundId, participantId, database);
    const pressSnapshot = await transaction.get(currentPressRef);

    if (pressSnapshot.exists()) {
      throw new HotButtonError("already-pressed", "Your press is already registered.");
    }

    const participant = participantSnapshot.data();

    transaction.set(currentPressRef, {
      participantId,
      username: participant.username,
      usernameKey: participant.usernameKey,
      roundId: game.roundId,
      roundNumber: game.roundNumber || null,
      roundStartedAt: game.roundStartedAt,
      pressedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    });
  });
}

export async function enableRound() {
  const database = requireDb();
  await ensureGameDocument();

  await runTransaction(database, async (transaction) => {
    const currentGameRef = gameRef(database);
    const gameSnapshot = await transaction.get(currentGameRef);
    const game = gameSnapshot.exists() ? gameSnapshot.data() : {};

    if (game.isButtonEnabled) {
      return;
    }

    const needsNewRound = !game.roundId || game.roundStartedAt;
    const roundId = needsNewRound ? createId("round") : game.roundId;
    const roundNumber = needsNewRound ? Number(game.roundNumber || 0) + 1 : Number(game.roundNumber || 1);
    const currentRoundRef = roundRef(roundId, database);

    transaction.set(
      currentRoundRef,
      {
        ...(needsNewRound ? cleanRoundPayload(roundId, roundNumber) : {}),
        roundId,
        roundNumber,
        status: "active",
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: !needsNewRound }
    );

    transaction.set(
      currentGameRef,
      {
        isButtonEnabled: true,
        roundId,
        roundNumber,
        roundStartedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });
}

export async function disableRound() {
  const database = requireDb();
  await ensureGameDocument();

  const snapshot = await getDoc(gameRef(database));
  const game = snapshot.exists() ? snapshot.data() : null;
  const batch = writeBatch(database);

  batch.set(
    gameRef(database),
    {
      isButtonEnabled: false,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  if (game?.roundId) {
    batch.set(
      roundRef(game.roundId, database),
      {
        status: "disabled",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  await batch.commit();
}

export async function resetRound() {
  const database = requireDb();
  await ensureGameDocument();

  const snapshot = await getDoc(gameRef(database));
  const game = snapshot.exists() ? snapshot.data() : {};
  const roundId = game.roundId || createId("round");
  const roundNumber = Number(game.roundNumber || 1);
  const batch = writeBatch(database);

  batch.set(
    roundRef(roundId, database),
    game.roundId
      ? {
          roundId,
          roundNumber,
          status: "waiting",
          startedAt: null,
          resetAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      : cleanRoundPayload(roundId, roundNumber),
    { merge: Boolean(game.roundId) }
  );
  batch.set(
    gameRef(database),
    {
      isButtonEnabled: false,
      roundId,
      roundNumber,
      roundStartedAt: null,
      resetAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await batch.commit();

  if (game.roundId) {
    await deleteCollection(database, ["rounds", game.roundId, "presses"]);
  }
}

export async function resetGameToStart() {
  const database = requireDb();
  await ensureGameDocument();

  const roundId = createId("round");
  const batch = writeBatch(database);

  batch.set(roundRef(roundId, database), cleanRoundPayload(roundId, 1));
  batch.set(
    gameRef(database),
    {
      ...cleanGamePayload(roundId, 1),
      gameResetAt: serverTimestamp()
    },
    { merge: true }
  );

  await batch.commit();
}

async function deleteSnapshotDocuments(database, snapshot) {
  let batch = writeBatch(database);
  let batchSize = 0;
  let total = 0;

  for (const documentSnapshot of snapshot.docs) {
    batch.delete(documentSnapshot.ref);
    batchSize += 1;
    total += 1;

    if (batchSize === 450) {
      await batch.commit();
      batch = writeBatch(database);
      batchSize = 0;
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }

  return total;
}

async function deleteCollection(database, pathSegments) {
  const snapshot = await getDocs(collection(database, ...pathSegments));
  return deleteSnapshotDocuments(database, snapshot);
}

export async function deleteAllData() {
  const database = requireDb();
  const counts = {
    participants: 0,
    usernames: 0,
    rounds: 0,
    presses: 0
  };

  counts.participants = await deleteCollection(database, ["participants"]);
  counts.usernames = await deleteCollection(database, ["usernames"]);

  const roundsSnapshot = await getDocs(collection(database, "rounds"));

  for (const roundSnapshot of roundsSnapshot.docs) {
    counts.presses += await deleteCollection(database, [
      "rounds",
      roundSnapshot.id,
      "presses"
    ]);
  }

  counts.rounds = await deleteSnapshotDocuments(database, roundsSnapshot);

  const roundId = createId("round");
  const batch = writeBatch(database);
  batch.set(gameRef(database), {
    ...cleanGamePayload(roundId, 1),
    createdAt: serverTimestamp(),
    fullResetAt: serverTimestamp()
  });
  batch.set(roundRef(roundId, database), cleanRoundPayload(roundId, 1));
  await batch.commit();

  return counts;
}

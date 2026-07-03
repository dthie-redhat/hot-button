# Hot Button

Hot Button is a lightweight web app for live quiz, training, conference, and classroom sessions. Participants join from their own device, choose a made-up username, and press a large button when the host opens the round. A shared display shows the order of valid presses and the elapsed time for each response.

The app is designed to be hosted as a static GitHub Pages site with Firebase Realtime Database providing low-volume live shared state.

## Interfaces

The app has three pages:

- `index.html`: participant button page
- `admin.html`: host/admin controls
- `display.html`: read-only live display for the room

## Implemented Behavior

- Participants register a unique made-up username before pressing.
- Usernames are cached in the browser with `localStorage`.
- Duplicate usernames are rejected.
- Participants can change username from a small control on the button page.
- The admin can enable or disable the button with a single state-aware toggle.
- The admin can reset the current round between questions.
- The admin can reset the game back to Round 1 while preserving participants and clearing round history.
- The admin can see the full current participant list.
- Presses before the button is opened are ignored.
- Each participant can press only once per round.
- Press timestamps use Firebase Realtime Database server timestamps.
- Admin and display pages subscribe to live Realtime Database updates.
- Admin, participant, and display pages show clearer connection/reconnection states.
- The display page sorts responses by fastest valid press.
- The display page shows the supplied participant QR code and URL.
- The admin can delete all participants, username reservations, rounds, and press history.

## Backend Choice

This project uses Firebase Realtime Database rather than a queue.

A queue would be good for processing one-way events, but Hot Button needs shared live state: whether the button is open, who is registered, which round is current, and the current ordered response list. Realtime Database is a better fit because it is built around synchronising small JSON state trees to many connected clients, supports server timestamps, supports transactions, and exposes connection state to browser clients.

## Project Structure

```text
.
├── index.html
├── admin.html
├── display.html
├── assets/
│   ├── hot-button-QR.png
│   └── redhat-logo.png
├── src/
│   ├── admin.js
│   ├── config.js
│   ├── display.js
│   ├── firebase.js
│   ├── participant.js
│   ├── render.js
│   ├── store.js
│   ├── styles.css
│   └── utils.js
├── database.rules.json
├── firebase.json
└── .nojekyll
```

There is no build step and no package install. The browser loads Firebase's hosted ES modules directly.

## Firebase Setup

1. Create a Firebase project.
2. Add a web app in Firebase project settings.
3. Create a Realtime Database.
4. Copy the Firebase web app config into `src/config.js`.
5. Add the Realtime Database URL to `databaseURL` in `src/config.js`.
6. Publish the rules from `database.rules.json`.

The config file currently contains placeholders:

```js
export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_DATABASE_NAME.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};
```

The public Firebase config is expected to be visible in a static frontend. Access control should be handled by Realtime Database rules and by the low-risk nature of the stored data.

The Realtime Database URL depends on the database location. Newer projects often use a URL like:

```text
https://YOUR_PROJECT_ID-default-rtdb.REGION.firebasedatabase.app
```

Copy the exact URL shown in the Firebase console rather than guessing it.

## Admin Passcode

The admin page uses a simple client-side passcode hash. This is a convenience barrier, not strong security.

The default passcode is:

```text
hot-button-admin
```

Change it before using the app for a real event. To generate a new SHA-256 hash:

```bash
printf %s "your-new-passcode" | shasum -a 256
```

Then replace `adminPasscodeSha256` in `src/config.js` with the hash value.

## Local Preview

Serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then open:

- Participant: `http://localhost:8000/index.html`
- Admin: `http://localhost:8000/admin.html`
- Display: `http://localhost:8000/display.html`

The app will show a Firebase setup warning until `src/config.js` contains real Firebase values.

## GitHub Pages Deployment

1. Commit the files to a GitHub repository.
2. In the repository settings, enable GitHub Pages.
3. Select deployment from the repository branch and root folder.
4. Open the published `index.html`, `admin.html`, and `display.html` pages.

The `.nojekyll` file is included so GitHub Pages serves the static files without Jekyll processing.

## Realtime Database Data Model

The app stores only temporary quiz/session data.

```text
settings/game
participants/{participantId}
usernames/{encodedUsername}
rounds/{roundId}
rounds/{roundId}/presses/{participantId}
```

### `settings/game`

Tracks the current round, whether the button is open, and a simple revision number for state changes.

Important fields:

- `isButtonEnabled`
- `roundId`
- `roundNumber`
- `roundStartedAt`
- `revision`
- `updatedAt`

### `participants/{participantId}`

Stores a browser-generated participant ID and made-up username.

Important fields:

- `participantId`
- `username`
- `usernameKey`
- `usernameDocId`
- `createdAt`
- `updatedAt`

### `usernames/{encodedUsername}`

Reserves usernames so duplicates can be rejected.

Important fields:

- `participantId`
- `username`
- `usernameKey`

### `rounds/{roundId}/presses/{participantId}`

Stores one valid press per participant per round.

Important fields:

- `participantId`
- `username`
- `roundId`
- `roundNumber`
- `roundStartedAt`
- `pressedAt`

Elapsed response time is derived in the UI from `pressedAt - roundStartedAt`.

## Reset Behavior

The admin screen has three reset choices.

Round reset:

- Disables the button.
- Keeps the current round number.
- Clears the visible response list.
- Creates a fresh active `roundId` instead of deleting old press entries.
- Keeps participant registrations and username reservations.
- Preserves old round data as historical session data.

Game reset:

- Disables the button.
- Creates a new waiting Round 1.
- Preserves registered participants.
- Deletes existing stored round and press history.
- Makes the current live response list empty because the current round is new.

Delete all data:

- Disables the button.
- Deletes participant records.
- Deletes username reservations.
- Deletes round documents.
- Deletes press history.
- Creates a fresh waiting game state.

## Data and Privacy

Hot Button should only store:

- Made-up usernames
- Generated participant identifiers
- Round state
- Button press timestamps

It should not collect real names, email addresses, phone numbers, participant accounts, or long-term analytics.

## Security Notes

This is intentionally a low-risk event tool.

- The admin passcode is client-side and can be inspected by a determined user.
- Realtime Database rules validate the general data shape, but admin-style writes are still convenience-gated.
- Do not store personal or sensitive information in this app.
- For stronger security later, add Firebase Authentication or a small trusted backend for admin actions.

## Success Criteria

The project is ready when:

- A participant can register a unique username and press after the host opens the round.
- Early presses do not count.
- A participant cannot press twice in the same round.
- Admin and display pages update live.
- The display page shows response order and elapsed times clearly.
- The admin can reset between questions.
- The admin can fully delete quiz data before another event.
- The site can be hosted as static files on GitHub Pages.

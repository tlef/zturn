# zturn

Infocom's Z-machine games over HTTP, one turn per request. Send a line of input, get back the game's text and its status line. Sessions are a replayable log of what was typed, so they survive restarts, can be undone, and can be shared as a seed plus a list of commands.

The name is the unit of work: a Z-machine turn, one per request.

## Contents

- [Quick start](#quick-start)
- [Story files](#story-files)
- [Playing](#playing)
- [The API](#the-api)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Development](#development)
- [Configuration](#configuration)
- [Deploying](#deploying)
- [Writing an adapter](#writing-an-adapter)

## Quick start

Node 22.12 or later. No native modules; SQLite comes from Node itself.

```bash
npm install
mkdir stories            # put zork1.z3 here, see below
npm run build
npm start
```

Open http://127.0.0.1:41732. For development, `npm run dev` watches and restarts, and `/docs` serves Swagger UI.

## Story files

The games are not in this repository. Infocom's story files are freely downloadable but not open-licensed, so the service reads them from a directory instead of shipping them.

- **Where:** the directory named by `STORY_DIR`, default `./stories`.
- **Format:** Z-machine version 3 files with a `.z3` extension. All three Zorks are v3. Infocom often distributed them as `ZORK1.DAT`; rename to `zork1.z3`.
- **Ids:** the file name without the extension, lowercased. `zork1.z3` is game `zork1`. Known ids get proper titles, anything else is listed under its id.
- **Other files:** anything that is not a v3 story is skipped with a warning at startup. A missing directory is a warning, not a crash.

A freely redistributable v3 game for trying things out is `advent.z3`, the Adventure port that ships with the [ifvms.js](https://github.com/curiousdannii/ifvms.js/tree/master/tests) test suite.

## Playing

**Browser.** The home page is a terminal. Pick a game, type. The session id and token stay in the browser's local storage so a reload resumes. Undo rewinds a turn. Share link puts the seed and commands in the URL so someone else gets the same game replayed to the same point. Export saves that as a file.

**CLI.** A readline loop over the API. It talks to `http://127.0.0.1:41732` unless `ZTURN_URL` or `--url` says otherwise.

```bash
npm run cli -- games
npm run cli -- play zork1
npm run cli -- play zork1 --seed 7
npm run cli -- play --session ID --token TOKEN
npm run cli -- export --session ID --token TOKEN > replay.json
npm run cli -- import replay.json --play
```

Ctrl-D leaves the game and prints the command to resume it.

**Slack.** `/slack` on a running server walks through connecting your own Slack app. The app is yours, in your workspace, never published. One game per channel; everyone in the channel plays and sees every move. Requires `SLACK_SECRET_KEY` on the server, see [Deploying](#deploying).

## The API

| Route | Purpose |
|---|---|
| `GET /games` | Playable stories: id, title, release, serial. |
| `POST /sessions` | Start a game. Body `{gameId, seed?}`. Returns the session, its token, and the intro as turn 0. |
| `GET /sessions/:id` | Turn number, status line, what the game is waiting for. |
| `POST /sessions/:id/turns` | Play one turn. Body `{input, expectedTurn?, idempotencyKey?}`. |
| `GET /sessions/:id/transcript` | Every turn with its input and output. |
| `POST /sessions/:id/rewind` | Undo. Body `{toTurn}`. |

Everything under `/sessions/:id` needs the session's token as a bearer token. The token is the only credential and is only shown once, when the session is created.

A turn:

```bash
curl -s http://127.0.0.1:41732/sessions/SESSION_ID/turns \
  -H 'authorization: Bearer TOKEN' \
  -H 'content-type: application/json' \
  -d '{"input":"open mailbox","expectedTurn":0,"idempotencyKey":"any-unique-string"}'
```

```json
{
  "turn": 1,
  "out": {
    "text": "Opening the small mailbox reveals a leaflet.",
    "status": { "location": "West of House", "score": 0, "moves": 1 },
    "awaiting": "line"
  }
}
```

**expectedTurn** is the turn the client thinks the session is on. If someone else played first, the response is a 409 carrying the turn that actually landed and its output, so the client can show it and retry. Omit it and the turn is played regardless. Chat adapters should send it; a CLI need not.

**idempotencyKey** is a caller-chosen string, unique per attempted turn. A repeat of the same key returns the stored reply and does not step the game. Derive it from the platform's own event id, and a redelivered event is harmless.

**status** is `null` once the game has ended, and `awaiting` is `none`. Further turns are a 409 with `game_over`. Start a new session.

Errors are JSON with a stable code: `{"error": "turn_conflict", ...}`. The status codes are 400 for bad input, 401 for a bad token, 404 for an unknown game or session, 409 for a conflict or a finished game.

Input is passed to the game untouched. There is nothing to sanitize because it never reaches a shell, a path, or a control channel. The only limit is 256 bytes.

## How it works

**A turn is a pure function.** The Z-machine runs until it hits a read instruction and then has nothing to do until a line arrives. That pause is the turn boundary. A snapshot is the VM's state at that instant. Given a snapshot and a line, the engine returns a new snapshot and the text produced. It performs no I/O and reads no clock.

**Randomness comes from the seed.** Every session gets a 32-bit seed. The engine answers the game's `random` instruction from a generator started with that seed, never from the system. So the same seed and the same commands always produce the same game: the thief's wanderings, the combat, all of it. Zork itself never seeds anything; this is imposed from outside, and it is what the rest of the design depends on.

**Sessions are the input log.** Because turns are deterministic, a session is fully described by its seed and the list of inputs. That list is stored. Snapshots are a cache: the server keeps the latest one per session in memory, and on a miss it replays from the start, which costs about half a millisecond per turn. Undo truncates the list. Transcripts, replays and share links fall out for free.

**No locks.** Two people in a channel typing at once and Slack redelivering an event are the same problem. Commits are a compare-and-swap on the session's turn number, so exactly one of two racing turns lands. Idempotency keys make the retry safe.

**The interpreter is ZVM** from [ifvms.js](https://github.com/curiousdannii/ifvms.js), the Z-code interpreter used by Parchment. The engine gives it a minimal Glk layer that captures main-window text, records what the VM is waiting for, and cancels any file prompt. When the game itself types `save`, the game reports a failure and carries on. The status line is read from the VM's globals, not parsed from text.

## Project structure

```
src/
├── index.ts                  entry point: env → config → App
├── app.ts                    composition root: Koa, middleware, every object
├── logger.ts
├── api/                      routes; parse the request, call a controller, set the body
├── controllers/
│   ├── session-controller/   the turn function's caller: version and idempotency rules, replay, commit
│   ├── slack-controller/     slash commands, bridge registration, signature checks
│   ├── api-docs-controller/  Swagger, development only
│   └── health-controller/
├── models/
│   ├── sessions/             session and turn storage, memory and SQLite
│   └── slack-apps/           bridges and channel-to-session mappings
├── libs/
│   ├── engine/               the Z-machine engine: ZVM adapter, Glk shim, PRNG, snapshots
│   ├── game-registry/        scans the story directory, one engine per game
│   ├── snapshot-cache/       in-process LRU over the input log
│   ├── token/                ids, seeds, hashed bearer tokens
│   ├── secret-box/           AES-GCM for secrets at rest
│   ├── slack-signing/        Slack's request signing
│   ├── database/             the SQLite connection
│   └── controller-error/
└── adapters/
    ├── cli/                  terminal client, talks only HTTP
    ├── web/page/             the home page, served at /
    └── slack/page/           the Slack setup page, served at /slack
```

Three layers, never skipped: API files parse requests and call controllers. Controllers hold the logic and may use several models and libs. Models store and fetch, nothing more, and do not know about each other. Every collaborator arrives through a constructor, and `app.ts` is the only place that calls `new` on one.

Each controller, model and lib is a directory with `index.ts` (exports), `types.ts` (interfaces and an `ERRORS` enum), and `src/` (the class, its validator, its tests).

## Development

```bash
npm run dev          # tsx watch
npm run build        # tsc, copy static pages, generate api-docs/
npm test             # mocha + c8
npm run lint         # eslint + prettier --check
npm run lint:fix
npm run type-check
```

Tests live beside the code as `*.test.ts`. API tests build a real `App` with a fake engine and drive it through supertest, so nothing above the engine needs a story file.

The engine tests do. They skip with a message unless `stories/zork1.z3` exists or `ZTURN_TEST_STORY` points at a v3 file:

```bash
ZTURN_TEST_STORY=stories/advent.z3 npm test
```

`.vscode/` has a build task and launch configs for the server and for the current test file.

## Configuration

Environment variables, read once in `index.ts`. Copy `.env.sample` to `.env` for development.

| Variable | Default | |
|---|---|---|
| `ENV` | `development` | `development` and `local` serve `/docs`; anything else does not. |
| `HOST` | `127.0.0.1` | Bind address. `0.0.0.0` behind a proxy. |
| `PORT` | `41732` | |
| `STORY_DIR` | `./stories` | Where the `.z3` files are. |
| `DATABASE_PATH` | `./data/zturn.sqlite` | Created if missing. `:memory:` for tests. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. Logs are JSON lines. |
| `SLACK_SECRET_KEY` | unset | 64 hex characters. Enables the Slack bridge. Signing secrets are encrypted with it. |

## Deploying

The Dockerfile builds a production image. Story files and the database are volumes, not part of the image.

```bash
mkdir -p stories                      # add zork1.z3 etc.
SLACK_SECRET_KEY=$(openssl rand -hex 32) docker compose up -d
```

That listens on 41732. Put a reverse proxy with HTTPS in front of it. Session tokens travel in request headers, and the Slack bridge is only useful on a public HTTPS URL because Slack has to call it.

Keep `SLACK_SECRET_KEY` stable across deploys. Changing it makes every registered Slack bridge unable to verify its app's signatures; visitors would have to activate again.

Sessions are small, a few kilobytes each, and are never deleted.

## Writing an adapter

Anything that can send a line of text and read JSON can play. The CLI in `src/adapters/cli/` is the reference. The rules:

- **One session per conversation.** Store its id and token, nothing else.
- **Always send `expectedTurn`** if more than one person can type. On a 409, show the turn that landed and let the person try again.
- **Derive `idempotencyKey` from the platform's own event id.** Redeliveries then cost nothing.
- **Render the status line as the header** and the text as the body. The text has no prompt; add one if the medium wants it.
- **When `awaiting` is `none`, the game is over.** Offer a new one.

Adapters know nothing about the Z-machine and import nothing from the server. The CLI could be lifted into its own package unchanged.

## Credits

Zork is a trademark of Activision. The Z-machine interpreter is ZVM by Dannii Willis, MIT licensed. The design replaces an earlier service, restful-frotz, that drove an interpreter binary over stdin and scripted the game's own save and restore commands. Every workaround that needed is gone because the control channel and the player's input are no longer the same pipe.

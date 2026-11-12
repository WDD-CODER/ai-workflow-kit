# Plan 115 — The Human can test a slot from a phone on the home Wi-Fi, without a tunnel

Status: draft
Parked: 2026-11-12 — the Human: save it with its context now, build it later (freeze: new work)
Depends-on: none
Snapshot: ef9d67c
Source: FoodVibe Planner hand-off 2026-11-12, item 6 (optional part), and that session's answers (transcript 57408b87). The Human, 2026-11-12: "6b — what it gave me didn't work in my phone, save the plan with context, we will do later". Item 6's card-format change was dropped by the Human: "the way the link was presented before is good".

## Problem Statement

**What exists.** `core/scripts/slot-serve.mjs` serves a slot for the PC only:
- The backend's CORS allows only `http://localhost:<fe>` (`slot-serve.mjs:224`, `ALLOWED_ORIGIN`).
- The frontend's environment points the API at `http://localhost:<be>` (`core/scripts/lib/slot-procs.mjs:635`, `generateEnvironmentSlot`).
- The frontend binds to localhost.

A phone on the same Wi-Fi therefore cannot reach the app, and if it could, its API calls would go to the phone's own localhost.

**What FoodVibe did instead.** Its session used FoodVibe's own `scripts/remote-port.mjs on` (a cloudflared tunnel; not a kit script). It printed `REMOTE: on url=https://<random>.trycloudflare.com/?k=<key> … (4202/3002 via 4292)`. The Human got the `?k=` link and then plain paths on the same host. The phone sign-in was `demo_chef`, because the dev guest auto-login answers 404 from anywhere but the PC.

**Two accounts that do not agree — settle them first (Critical Question 1).**
- The Human: "what it gave me didn't work in my phone".
- The FoodVibe session: no error was reported. The Human passed checks ①–⑥ of batch 1 on the phone and the PC, and the only complaint was the missing PC link.

**Why a LAN mode anyway.**
- A tunnel needs cloudflared, a random host that changes every time, a key in the URL and an expiry.
- On the home Wi-Fi, `http://<pc-lan-ip>:<fe>` would be enough, if the slot binds to the network, the API goes through the dev server's proxy (same origin, so no CORS and no localhost URL), and the backend accepts that origin.

## Goals & Success Criteria

**Primary:** `node scripts/slot-serve.mjs --lan` serves the slot so that a phone on the same Wi-Fi opens `http://<pc-lan-ip>:<fe>/<path>` and uses the app, signed in with a named account, with no tunnel.

- [auto] `node --test tools/test/slot-serve.test.mjs` passes, with new cases:
  - `--lan` binds the frontend to `0.0.0.0`.
  - The generated environment sends API calls to a relative path served by the dev-server proxy, not `http://localhost:<be>`.
  - The backend's allowed origins include `http://<lan-ip>:<fe>` as well as `http://localhost:<fe>`.
  - Without `--lan`, nothing changes from today (same env, same bind).
- [auto] Same test: `--lan` prints one line `LAN: http://<lan-ip>:<fe>` with the PC's private IPv4 address (192.168.x, 10.x, 172.16–31.x). With no private address, it prints `LAN: no private network address`, exits non-zero and starts nothing.
- [auto] `npm test`, `npm run build`, `npm run lint` and `node tools/drift-check.mjs --target .` pass after `node tools/sync.mjs --target . --apply`.
- [human] In FoodVibe, with `slot-serve.mjs --lan` in a slot, the Human opens the printed LAN link on the phone (same Wi-Fi), signs in with the named account and passes one real card.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: **solo flow** (`git switch -c feat/115-<slug>` from `origin/main`, then `/ship`).
- After the merge: a minor release, which each project gets through `kit-sync`.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/slot-serve.mjs
core/scripts/lib/slot-procs.mjs
core/docs/agent/job-validation.md
tools/test/slot-serve.test.mjs
scripts/**
docs/agent/**
kit.json
CHANGELOG.md
```

## Read Scope
Entire repo; FoodVibe's `scripts/remote-port.mjs`, its dev-server proxy config and its backend CORS setup (read only).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — no model, tier or agent change.

## Step 0 — Reality Check
1. Ask the Human Critical Question 1 and record the answer under Execution Notes before any code.
2. Read how FoodVibe's frontend dev server proxies (`proxy.conf` or the equivalent). Can the API go through it, and does the backend need the LAN origin at all once calls are same-origin?
3. Check whether the guest auto-login can stay PC-only (recommended). If it can, `--lan` prints the account to use, and the login is not opened to the network.

## Atomic Sub-tasks
- [ ] L1: Write the failing tests for the network mode and for today's mode staying unchanged — tools/test/slot-serve.test.mjs
- [ ] L2: Serve the slot on the home network on request, with the API through the dev server — `--lan`: bind 0.0.0.0, relative apiUrl via the proxy, LAN origin added to ALLOWED_ORIGIN, print `LAN: http://<ip>:<fe>` — core/scripts/slot-serve.mjs, core/scripts/lib/slot-procs.mjs
- [ ] L3: Say in the validation doc when to use the network link and which account a phone signs in with — one short paragraph; the card layout itself does not change — core/docs/agent/job-validation.md
- [ ] L4: Resync the installed copy, run every check, and release it — scripts/**, docs/**, kit.json, CHANGELOG.md

## Technical Considerations
- **Security surface:** binding to `0.0.0.0` exposes a dev server, with dev data and any dev-only routes, to everyone on the network. The mode is opt-in per start, never the default, and the guest auto-login stays localhost-only.
- Windows Firewall asks the first time node listens on the network. The doc names this prompt, which the Human allows on private networks only.

## Out of Scope
- A change to the card format: the Human keeps today's layout.
- Making cloudflared or FoodVibe's `remote-port.mjs` part of the kit.

## Critical Questions
1. What exactly did not work on the phone: the tunnel link not opening, the page opening but not signing in, a wrong page, or the missing PC link? The FoodVibe session saw no phone error and the Human passed the checks on the phone.

## Execution Notes
- 2026-11-12 Planner: saved parked, from the FoodVibe hand-off and that session's answers.

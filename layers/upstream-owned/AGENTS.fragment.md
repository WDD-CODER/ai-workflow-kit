## Hard rules

- This repo is a copy of an upstream repo. Never edit an upstream-owned path (`ownership.upstreamPaths` in `kit.config.json`) — the scope guard denies it and an `approved:` does not apply; an app fix goes to the upstream owner as a brief. Never push to `upstream`.

## Skill triggers

| Bring {{git.mainBranch}} up to the upstream repo ("pull copy", "sync from upstream") | `.claude/commands/pull-copy.md` |

## Standards index

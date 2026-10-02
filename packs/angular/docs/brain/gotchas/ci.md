# ci gotchas

## Prod build fails when Google Fonts CDN is unreachable

**What hurt:** `ng build` (production) failed with `ENOTFOUND fonts.googleapis.com` because Angular's font-inlining plugin fetches `@import url('https://fonts.googleapis.com/...')` at build time. Dev builds passed; `/ship` hard-stopped.

**Why the obvious fix is wrong:** Retrying the build or waiting for network only papers over CI/sandbox environments that cannot reach Google. Leaving `optimization: true` (default) keeps the footgun.

**What to do instead:** Set `optimization.fonts: false` for `production` and `gh-pages` in `angular.json`. Keep the CSS `@import` so browsers still load fonts at runtime when the CDN is available. Self-host fonts only if you need offline runtime too.

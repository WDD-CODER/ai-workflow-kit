# Kit validation — the orchestrator's behaviours, proved in a sandbox

Kit repository only (like `/kit-learn`): `tools/validate-orchestrator.mjs`, `tools/lib/validate/**` and
`/validate-run` are never rendered into a project.

## What it does

One command stages each behaviour the orchestrator promises, in a throwaway sandbox, and decides PASS or FAIL from the
run's own files: `status.json` (plan states, `stops[]`, run notes), `calls.csv`, the run report, the console log and
`git log` of the sandbox's run branch. No model reads them and no model writes a verdict. The report quotes the
evidence each verdict rests on.

```
node tools/validate-orchestrator.mjs [--mode fake|real] [--kit-ref <tag>] [--cases V1,V3] [--keep]
                                     [--report <path>] [--max-input-tokens <n>] [--timeout-s <n>] [--dry-run]
```

- **Sandbox:** `tools/test/lib/run-plans-fixture.mjs` `makeProject`, one per case under the system temp folder: the
  kit installed from this working tree (or from `--kit-ref <tag>`), a local bare origin, dummy plans on `main`.
  Nothing reaches GitHub or any other project. Removed after its case unless `--keep`.
- **fake mode** (default, CI): `tools/test/fixtures/fake-claude.mjs` plays the builder and the reviewer. Each case's
  fake steps write the exact change its task asks for (`editFiles`, `appendFiles`), or ask a question (`escalate`).
- **real mode:** real `claude -p` on Sonnet for both tiers; the whole run stops at `--max-input-tokens` (default
  3,000,000, from each sandbox's `calls.csv`). `--dry-run` lists the calls and the cap and calls no model.
- **Time limit** per case: 300 s fake, 1800 s real (`--timeout-s`). Past it the case is FAIL `timed out after <n> s`.
  An error or a missing verdict is FAIL; only an explicit PASS passes.
- **Report:** printed, and written to `<temp>/kit-validation/<stamp>-<mode>/report.md` (`--report <path>` writes a
  copy). A failing case's run files are copied next to it under `logs/<case>/`. Exit 0 = every case PASS, 1 = a FAIL.

## The cases

| Case | Behaviour (plan) | What the case does | PASS only when |
| --- | --- | --- | --- |
| V1 | a run survives its session (100) | a stand-in session starts the run with `scripts/run-supervisor.mjs`, then is killed with its process tree while the plan builds | the run still finishes: `finished`, the plan merged, the report written, no `process died` stop |
| V2 | a sibling test needs no scope line (101) | the scope lists `src/price.mjs` only; the task also adds a test to `src/price.test.mjs` | merged, nothing called the test out of scope, the merged diff touches the test file |
| V3 | a plan file edited mid-run (102) | while the plan builds, a commit adds a line to its plan file on the run branch; the builder adds one too (a conflict) | merged with no park, and a run note or the report's "Plans changed during the run" names the plan file |
| V4 | missing packages repaired (103) | the app's test imports a local `file:` package; after plan A's merge, the merge folder's `node_modules` is deleted while plan B builds | B merged and a run note of B says the merge folder was installed again |
| V5 | a question stops only its plan (104) | P1's task needs a file outside its scope, P2 is independent; on the `ASK` card the case waits for P2, then answers `--choice 1` (`approved:`) | P2 merged while P1 waited, P1 resumed from its park branch with the file in its scope on the run branch, and merged |

Each dummy task has one passing change: the plan's `[auto]` check (`node scripts/check-<NNN>.mjs`) compares the exact
file contents, so a real builder cannot pass a case by doing something else.

## The negative control

`--kit-ref v2.1.0` installs the kit as it was before plans 100–104. Every case must FAIL there, with evidence that
shows why. A case that passes on v2.1.0 does not test its behaviour and must be rewritten.

## A FAIL

A FAIL is a finding, never a reason to soften a case or to change a shipped script inside this tool's plan: add one
line to `docs/brain/error-review.md` and fix it in a new plan (the first one, V1 on v3.0.0, became the v3.0.1 fix).

# Error review

Kit freeze (Human, 2026-11-07): no new kit plans until 10 real plans have run through `scripts/run-plans.mjs`. A kit bug
found in a run gets one line here, not a plan. Real runs so far: 1 of 10.

| Date | Run | Plan | What failed | Why |
| --- | --- | --- | --- | --- |
| 2026-11-07 | first | 092 | `--dry-run` printed the builder with `--model sonnet`; the real builder call ran `--model opus` (727k input tokens). | The dry run used `MODELS.build`; the real call used the start tier, and `startTier()` sent every plan naming an invariant (`INV-1: preserves` too) to the judgment tier. Fixed before the freeze (merged f774da9, ADR 0020): one shared builder call, `preserves` starts on build. |

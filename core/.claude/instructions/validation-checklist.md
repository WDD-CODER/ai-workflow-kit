# Validation Checklist Instruction

> **Canonical location:** `docs/agent/job-validation.md` → section **HOW TO VALIDATE checklist**.
>
> This file is a pointer stub. Do not maintain a second copy of the rules here.
> Both agents (Claude Code and Cursor) load the job-validation procedure for
> Path A (`/ship` Phase 4) and Path B (chat close-out / `/done`).

Execution agents show the HOW TO VALIDATE cards once, at the first validation
ask: the end-of-job close-out (JOB DONE / `/done`). A later `/ship` prints
`VALIDATED BY HUMAN` instead of repeating them; it shows the cards only when no
close-out happened before it. Planning / architecture-only turns with no
behavior change may skip.

---
description: Improve one skill from evidence counts, editing only its own folder (used by the nightly skill improver; also runnable by hand)
allowed-tools: Read, Glob, Grep, Edit, Write
argument-hint: <skill folder>
---

# /improve-skill — one better version of one skill

You are given a skill folder, evidence counts (numbers only) and its eval cases. Improve the skill so the eval
assertions pass more often and users correct it less. A separate judge scores the result blind: you never grade
yourself and you never see its verdict.

## Rules

1. Edit only files inside the given skill folder. Never touch another skill, a hook, a setting, a command, a script or
   an instruction file. A change outside the folder is discarded and aborts the whole run.
2. Do not edit the eval cases (`evals/evals.json`). Make the skill satisfy them by being clearer, not by copying them.
3. Follow the project's skill-authoring standard when it has one: a precise
   `description` with trigger phrases, short imperative steps, no duplicated rules, references moved to a `references/`
   file when SKILL.md grows past what every use needs.
4. Read the evidence as a hint, not a verdict:
   - many corrections after it fired -> an instruction is ambiguous or wrong; tighten it and add the missing
     "do not" or an example of the expected result;
   - tool failures after it fired -> a step names a command, path or order that fails; fix or add the check;
   - should-have-fired hits -> the description misses the way people ask; add those trigger phrases;
   - a large file -> cut text the model does not need on every use.
5. Smallest change that addresses the evidence. Keep what works. Never add a project name, a person, a machine path
   or a quote from a session; use invented example names.
6. Finish with two lines: what you changed (one sentence) and which evidence it answers.

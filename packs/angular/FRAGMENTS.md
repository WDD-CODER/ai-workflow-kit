# Angular pack fragments

Each `## <name>` section replaces the `<!-- PACK:<name> -->` (or `# PACK:<name>`) line in the core files.
Not installed itself. Placeholders render as in any kit file.

## style:feat

- No semicolons in `.ts` files. Single quotes in TS, double quotes in HTML.

## style:fix

- No semicolons in any `.ts` file touched during the fix.

## style:refactor

- No semicolons in any `.ts` file touched.
- Reference `cssLayer` skill before modifying any `.{{stack.stylesheetExt}}` file — layer order matters.

## style:security

- No semicolons in any `.ts` file touched.

## loads:refactor

- `cssLayer` skill — CSS layer ordering, BEM naming, token usage

## loads:security

- `auth-and-logging` skill — authentication guards, mutation logging, auth audit checklist, and the `auth-crypto.ts` hashing/token rules

## pre-commit:fix

node scripts/pre-commit-no-semi.mjs

## pre-commit:check

node scripts/pre-commit-security-grep.mjs

## techdebt

- `grep -rnE "@Input\(|@Output\(|BehaviorSubject" <scope>` — the legacy decorators and the banned state type lint does not catch
- `node scripts/techdebt-report.mjs scan` counts them too (the Angular rules: `legacy-decorator`, `behavior-subject`, `semicolon`)

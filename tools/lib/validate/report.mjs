// The report of tools/validate-orchestrator.mjs: the verdict line first, one table row per case, then each case's
// evidence quoted as the sandbox's files gave it.

/** `VALIDATION: PASS — 5 of 5 cases passed` or `VALIDATION: FAIL — 2 of 5 cases failed: V2, V4`. */
export function verdictLine(rows) {
  const failed = rows.filter((r) => r.verdict !== 'PASS')
  if (!rows.length) return 'VALIDATION: FAIL — no case ran'
  return failed.length ? `VALIDATION: FAIL — ${failed.length} of ${rows.length} cases failed: ${failed.map((r) => r.id).join(', ')}` : `VALIDATION: PASS — ${rows.length} of ${rows.length} cases passed`
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

export function report(rows, { mode, kit, date = new Date().toISOString().slice(0, 10), tokens = null, cap = null } = {}) {
  const out = [
    `# Orchestrator validation — ${mode} mode — ${date}`,
    '',
    `**${verdictLine(rows)}**`,
    '',
    `- Kit under test: ${kit}`,
    `- Mode: ${mode === 'real' ? 'real `claude` calls (Sonnet), each case in its own sandbox' : 'the fake builder and reviewer (tools/test/fixtures/fake-claude.mjs), no model call'}`,
    '- Every verdict comes from the sandbox\'s own files (status.json, run notes, calls.csv, git log), quoted below. No model reads them.',
    ...(tokens !== null ? [`- Input tokens used: ${tokens}${cap ? ` of the ${cap} cap` : ''}`] : []),
    '',
    '| Case | Behaviour (plan) | Verdict | Seconds | Why |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.id} | ${cell(r.title)} (${r.plan}) | ${r.verdict} | ${r.seconds} | ${cell(r.why)} |`),
    '',
  ]
  for (const r of rows) {
    out.push(`## ${r.id} — ${r.title} (plan ${r.plan}): ${r.verdict}`, '', r.why, '')
    if (r.evidence?.length) out.push('```text', ...r.evidence.map((l) => String(l).replace(/```/g, "'''")), '```', '')
    if (r.logs) out.push(`Run files of this case: \`${r.logs}\``, '')
    if (r.kept?.length) out.push(`Sandbox kept: ${r.kept.map((k) => `\`${k}\``).join(', ')}`, '')
  }
  return `${out.join('\n').trimEnd()}\n`
}

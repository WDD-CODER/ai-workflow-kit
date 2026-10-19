/**
 * The npm arguments that start the slot frontend dev server — a pure function: config values in, arguments out.
 * slot-procs.mjs starts the server with it; the kit's adoption report prints the same command from the project's config.
 *
 *   script    commands.dev: the npm script that serves the frontend
 *   exec      slots.feExec (optional): run this binary with `npm exec --` instead of the script
 *   portArgs  slots.fePortArgs: appended to the start command; {port} = the slot's frontend port
 *   port      the port (a number, or any text such as '{port}' to show the template)
 * A list may also be a comma-separated string. Node built-ins only (none needed).
 */
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean)

/** npm arguments: `exec -- <exec…> <portArgs…>` when `exec` is set, else `run <script> -- <portArgs…>`. */
export function frontendCommand({ script, exec, portArgs, port }) {
  const extra = list(portArgs).map((a) => a.replace(/\{port\}/g, String(port)))
  const bin = list(exec)
  return bin.length ? ['exec', '--', ...bin, ...extra] : ['run', String(script ?? ''), '--', ...extra]
}

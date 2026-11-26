# Local web view
`./skill-atlas serve [--port <n>]`: the same scan, in a browser, on this machine.
Another *thin client* over the core, like the CLI; *nothing is stored*.
## Server
- Listens on **127.0.0.1** only; port `4321` by default, `--port 0` picks a free one
- Prints `Skill Atlas at http://127.0.0.1:<port>` and runs until stopped
- A request whose `Host` is not `127.0.0.1` or `localhost` → 403: a web page cannot reach it by DNS rebinding
- A port that is taken or invalid → a clear message, exit code 1
- `GITHUB_TOKEN`, as for the CLI
## Page: `GET /`
- One field, a GitHub URL or a local directory, and **Scan**
- `/?target=<input>` scans at once; each scan puts its input in the address, so a view can be shared
- `<repository> · N skills`, then each skill: **name** linked to its file, the description's *first sentence*,
  its path and `also in <paths>` for copies; sorted by **name**, as in the CLI
- Warnings above the list; an error instead of it
## API: `GET /api/scan?target=<input>`
- 200: `{ repository, skills, warnings }`; each skill: `name`, `summary` (the first sentence), `description`,
  `path`, `link`, `copies`
- No `target` → 400; unreachable repository or any other scan error → 422; `{ error }` with the CLI's message
- Any other path → 404

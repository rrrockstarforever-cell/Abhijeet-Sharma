# Working rules for this project (read at every session start)

## Divide every task three ways, all at the same time
Claude, Codex and DeepSeek work together on every task in this project, in parallel, and the work is split between them.
- **DeepSeek** takes the largest share: reading whole files, reviews, checks, drafts and second opinions. It is called through `node tools/deeprelay-ask.mjs <file>` with `DEEPRELAY_MAX_TOKENS` set to 12000 or more. It has a 1M-token context.
- **Codex** takes scoped edits in named files only: `codex exec --sandbox workspace-write` for edits, `--sandbox read-only` for reviews. It runs in the background.
- **Claude** takes the judgement calls, the integration and the verification in the browser and with the tests.
- Start all parts together. Keep working while the others run. Never give two writers the same file.
- Report the combined result and say who did which part.

## Safety
- Never give Codex or DeepSeek unlimited access. Keep Codex in workspace-write mode.
- Do not commit, push or create GitHub releases without an explicit request from the user.
- Keep experiments on the sample branch (`sample/functional-fixes`) unless the user says otherwise.
- Never write API keys into files or chat.

## Verification
- After a change, run `npx tsc --noEmit -p .` (use `cmd.exe` if PowerShell blocks npx) and the quality tests in `tools/quality/`.
- For UI changes, check the screen in the browser at http://localhost:3100 in light and dark mode.

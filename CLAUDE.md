# Repo-specific instructions for Claude Code sessions

## Deploy workflow (overrides `Starhold Improvement Plan.md` A.2.5)

The improvement plan's default protocol says to push each phase to its own branch
and wait for Kevin to review the Vercel preview before merging to `main`. Kevin has
explicitly overridden that: **merge every completed phase branch directly into
`main` and push, with no confirmation step.** `main` is what Vercel builds for
`https://starhold.vercel.app/`, so this ships each phase live automatically as soon
as it's done.

- Still run every gate in A.2 first (`tsc --noEmit`, `validate.ts`, `tests/run-all.ts`,
  both builds) — those checks are not being skipped, only the human review pause is.
- Do a real fast-forward or merge of the phase work into `main` and `git push origin main`
  as the last step of the session, without asking Kevin to confirm.
- Still write the PROGRESS-3.md phase entry and report the summary back to Kevin —
  just don't block the merge/push on his go-ahead.

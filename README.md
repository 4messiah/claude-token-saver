# token-saver

A Claude Code mod that cuts token usage without changing what the model can do. It removes noise from the context instead of limiting the model.

## What it does

- **Shell output trimmer** (Bash and PowerShell): removes color codes, collapses progress bars and repeated lines. When output is longer than 200 lines (or about 24k characters), Claude sees only the first and last 80 lines. The full output is saved to a file, and Claude is told where to find it.
- **Duplicate-read guard**: if Claude tries to re-read part of a file it already read and the file hasn't changed, the read is refused and Claude is told to use the copy it has. Asking again goes through. The guard resets after a compaction.
- **Large-file outline**: a whole-file read of a file over 600 lines returns an outline of its functions, classes and headings with line numbers, so Claude can read only the part it needs. Asking again, or setting `allow_large`, reads the whole file.
- **Compact reminder**: a one-time pop-up at 40% and again at 70% context usage, suggesting `/compact`.

All limits are constants at the top of `hooks/register.ts`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install token-saver --marketplace 4messiah/claude-token-saver
```

Answer `y` to add the marketplace, then pick a scope (Enter for the user scope).

From a shell:

```bash
claude plugin install token-saver --marketplace 4messiah/claude-token-saver
```

In the Claude desktop app: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `4messiah/claude-token-saver`, then **Add plugin**.

## Notes

Saved shell output goes to the mod's `.output/` folder, which is not cleaned up automatically.

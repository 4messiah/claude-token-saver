# token-saver

A Claude Code mod that cuts token usage **without limiting what the model can do**.

In a long Claude Code session, most of your tokens don't go to Claude's thinking or its replies. They go to old tool output (build logs, test runs, whole files) that stays in the conversation and is sent back to the model with every message. This mod keeps that noise out of the context. Claude can still get anything it needs: nothing is deleted or hidden for good, and every part can be bypassed by Claude asking again.

It combines four parts:

---

## 1. Shell output trimmer

**Applies to:** Bash and PowerShell commands Claude runs.

**What it does:**
- Removes terminal color codes, which are invisible to you but cost tokens.
- Keeps only the final state of progress bars, so each bar adds one line instead of hundreds of redraws.
- Collapses runs of identical lines into one line plus "repeated N more times".
- If the output is still longer than **200 lines** (or about **24,000 characters**), Claude sees only the **first 80 and last 80 lines**, which is where commands put their summaries and errors. The full output is saved to a file, and Claude is told the file's path so it can read or search the middle when it needs to.

**Why it saves tokens:** one `npm install`, test run or build log can add 20,000–50,000 tokens. Without the trimmer, all of it stays in the context and is re-sent with every message for the rest of the session.

**What it never touches:** commands that fail. Error output always reaches Claude in full.

---

## 2. Duplicate-read guard

**Applies to:** Claude's `Read` tool.

**What it does:** remembers which files (and which line ranges) Claude has already read in this conversation, along with when each file was last modified. If Claude tries to read the same range of a file that **hasn't changed**, the read is refused with a short note saying the copy it already has is still current.

**Why it saves tokens:** in long tasks, models often re-read the same large file several times. Every copy stays in the context.

**Safety valves:**
- If the file was edited (by Claude or by you), the read goes through.
- If Claude asks a second time, the read goes through, so it can never get stuck.
- When the conversation is compacted, Claude's earlier copies are gone, so the guard forgets everything and starts over.

---

## 3. Large-file outline

**Applies to:** whole-file reads of text files over **600 lines**.

**What it does:** instead of loading the whole file, Claude first gets an **outline**: every function, class, type, heading and section, each with its line number. Claude then reads only the part it needs, using a line range.

**Why it saves tokens:** Claude usually needs one function in a 3,000-line file, not all of it.

**Safety valves:**
- Asking again, or reading with `allow_large`, loads the whole file.
- Files under 600 lines are not affected.
- Images, PDFs and notebooks are not affected.

---

## 4. Compact reminder

**What it does:** shows a one-time pop-up when the conversation reaches **40%** of the context window, and again at **70%**, suggesting `/compact` (or `/clear` if you're switching to an unrelated task). The reminders reset once usage drops below 25%.

**Why it saves tokens:** every message re-sends the whole conversation, so a full context makes each message cost more. Compacting early is the biggest manual saving there is, and this tells you when to do it without a meter on screen all the time.

---

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install token-saver --marketplace 4messiah/claude-token-saver
```

Answer `y` to add the marketplace, then pick a scope (press Enter for the user scope, so it runs in every session).

From a shell:

```bash
claude plugin install token-saver --marketplace 4messiah/claude-token-saver
```

In the Claude desktop app: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `4messiah/claude-token-saver`, then **Add plugin**.

## Customizing

All limits are constants at the top of [`hooks/register.ts`](hooks/register.ts):

| Setting | Default | Meaning |
| --- | --- | --- |
| `SHELL_MAX_LINES` | 200 | Shell output longer than this gets trimmed |
| `SHELL_HEAD` / `SHELL_TAIL` | 80 / 80 | Lines kept from the start / end |
| `SHELL_MAX_CHARS` | 24000 | Also trim output longer than this many characters |
| `BIG_FILE_LINES` | 600 | Whole-file reads above this get an outline first |
| `OUTLINE_MAX` | 120 | Most outline entries shown |
| `COMPACT_REMIND_AT` | [40, 70] | Context % at which to show a reminder |
| `COMPACT_RESET_BELOW` | 25 | Reminders re-arm once usage drops below this |

## Notes

- Full copies of trimmed shell output are saved in the mod's `.output/` folder. It isn't cleaned up automatically, so empty it now and then.
- The mod doesn't change the model, its settings, or the system prompt. It only changes how much tool output reaches the context.

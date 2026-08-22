# Incremental review

Review the push, carry the rest, and let the reader see which commit changed what.

This was a plan; it is now **built** — migration 0081 on the tracker, and the
scope/carried fields on the analyser's `/pr/analyse` contract. The reasoning is
kept in full rather than trimmed to a changelog, because the parts that look like
easy wins here are correctness bugs, and the next person to open this pipeline
should find why before they simplify one of them away.

---

## Where this starts

Every push re-reviewed the entire pull request. `listPullRequestFiles(number)` is
GitHub's PR-files endpoint — the full `base…head` diff — and
`PullRequestAnalysisService.start` re-sent it verbatim on every round.

Three consecutive rounds on one 12-file PR:

| Round | Push touched | Reviewed | Duration |
| ----- | ------------ | -------- | -------- |
| 1     | 12 files     | 12 files | 360s     |
| 2     | 2 files      | 12 files | 343s     |
| 3     | 1 file       | 12 files | 360s     |

Round 3 spent six minutes re-deriving eleven files it had already read twice, to
report three findings it had already reported.

The cost is not the main problem. The **turn budget** is: `reviewMaxTurns` caps
the KB review loop at 14, and `ReviewPolicy.Budget` scales it by depth first, so a
plan clamped to `quick` yields nine. Nine tool-call turns to walk a 110-file
graph, verify every draft finding, enumerate callers, probe failures, read
history — and then write JSON. It routinely runs out mid-walk. Scoping the deep
pass to what actually changed is a more direct fix for that than anything else
we have tried.

---

## Why the obvious version is a correctness bug

`MergeGate` counts criticals in `result.findings`, and findings are **replaced
wholesale** on every round. Review only the last commit and a still-present
blocker in an untouched file is simply absent from the new list — so the gate
sees zero criticals and **opens the merge**.

Full re-review is what prevented that. It is not thoroughness for its own
sake; it is the thing that gives the reviewer a fair chance to re-find what it
found before.

A quiet version of this already shipped: `previous_blockers` **asks** the reviewer
whether each earlier blocker is fixed, but nothing **carried** them. If the model
said nothing about one, it disappeared. The full diff was masking that.

> Every fail-open in this pipeline has had the same shape: something real exists,
> but not in the place the gate reads. A degraded review scoring 10/10. A
> migration blocker labelled `data` and silently demoted. Findings lost when the
> turn budget ran out. Real blockers routed into the risk matrix while the
> findings list said "comment". Incremental review without carry-forward would be
> the next one.

---

## The rule that makes it safe

**If a finding's file is untouched between the last reviewed head and this one,
and no symbol it cites was changed elsewhere, the finding is still there.**
Nothing needs to be asked.

The second clause exists because blast radius is global: deleting a caller in
file X can resolve a finding in untouched file Y, and carrying it forward would
report a defect that no longer exists. The file test alone would miss that.

That single rule turns incremental review from a gamble into arithmetic, which is
the same posture `ReviewRounds.diffRounds` already takes. A carried finding
cannot be lost to a distracted reviewer — which is exactly what happened when the
`?owner` tenant pivot went into a risk matrix and never reached the findings list.

Carried findings keep their line numbers, because an untouched file has not
moved. That is the same fact the round fingerprint relies on when it *excludes*
line, arriving from the other direction.

`CarryForward.partitionForCarry` is the rule, and it errs toward re-judging in
three further cases the prose above does not cover: a finding with no file (its
premise is unprovable), a finding whose **evidence anchor** sits in a changed
file (the reviewer's own statement of what it rests on moved), and — always — a
finding whose text names a changed export.

### Testing the symbol, concretely

`PrFinding` carries no symbol field — only `file`, `line`, `title`, `detail` and
`evidence` anchors. So the test is a text match, and it should stay one:

> A carried finding is **re-judged** when any exported symbol name from the
> tracker's own diff scan appears in its title or detail.

Deterministic, tracker-side, no model, no graph round trip —
`DiffFacts.changedExportedSymbols`. It over-triggers on short or common names — a
changed `get` would re-judge half the list — which costs a re-judgement rather
than a missed defect, so the failure direction is right. If the over-triggering
turns out to be expensive, the fix is a minimum name length before the test
applies, not a cleverer matcher.

Two deliberate differences from the analyser's `factscan.changedExported()`,
which the plan originally named as the source:

- The scan is **tracker-side**. It answers whether a finding may ride along
  unexamined, and routing that through the analyser would put a network hop, a
  failure mode and a model in front of a decision that is arithmetic.
- It includes **added** exports, which factscan does not. Factscan exists to
  demand a caller-impact list, so a brand-new export is genuinely not its
  business. This test does the opposite job, and a new export in a shared module
  is exactly the sort of change that can invalidate a finding in a file the diff
  never mentions.

Matching is word-boundary and case-**sensitive**, so a changed `findUser` does not
re-judge every finding that mentions `findUserById`.

---

## Deciding the scope — rules, not a model

The scope decision is **rule-based**: `ReviewScope.decideScope`, pure, logged on
every round with the rule that fired.

Take the **full** review when any of these hold:

| Condition | Code | Why |
| --- | --- | --- |
| No previous round | `first_round` | Nothing to carry. |
| Previous round was `degraded` | `degraded_baseline` | A partial review is not a baseline. Carrying from one would manufacture the appearance of progress. |
| Last reviewed head is **not an ancestor** of this head | `force_push` / `ancestry_unknown` | Force-push or rebase: the relationship between the two heads cannot be established, so nothing may be carried. |
| The base moved | `base_moved` | `base…head` changed for reasons the push did not cause. |
| The push changed nothing | `empty_push` | An incremental pass would review an empty diff. |
| A **migration** is in the diff | `migration` | Schema changes reach code the diff never mentions — see the `tasks.tenant_id` rename that broke `tasks-repo.ts` without appearing in it. |
| The **review profile changed** since the last round | `profile_changed` | Different lenses, different blocking bar. Round *n* was judged by a different reviewer than round *n−1*. |
| Changed symbols have **more than 25 dependents** in the graph | `blast_radius` | The "looks small, isn't" case. The changed-export scan plus `/neighbours` already answers this; it is a lookup, not an inference. |
| **4 rounds** since the last full pass | `periodic` | Bounds how long a finding can ride along unexamined, and gives the pipeline a way to recover from a bad baseline. |
| **75%** of the last round rode along unexamined, **and at least 4 findings did** | `carried_saturation` | A review made mostly of assumptions is not a review. The absolute floor is not decoration — see below. |
| The analyser refused the incremental request | `dispatch_refused` | Not a rule — a half-finished deploy. See below. |

Otherwise: `push_scoped`.

`unknown` ancestry is not a synonym for `diverged`, but both force a full pass: a
scope decision has to be able to prove its premise. A **truncated** compare is
read as unknown ancestry for the same reason — the provider capped the file list,
and the files it dropped are exactly the ones nothing would review.

An unavailable dependent count is **not** an alarm. The count escalates a round
to full, so treating a graph blip as "escalate" would make every blip cost six
minutes.

### On a decider agent

A model that reasons about whether a change "needs" a full review is tempting and
should wait. The interesting case — a one-line edit to a shared kernel function —
is already answered deterministically by the dependent count, and more reliably
than a model forming an impression of a diff.

If the logged reasons later show a large ambiguous middle, add one, but give it
**asymmetric authority**: it may escalate incremental → full, never downgrade
full → incremental. A wrong escalation costs six minutes. A wrong downgrade costs
a review nobody performed, with the merge gate reading the result.

---

## What a round does

1. **Decide the scope** by the table above. The decision, its reason and the
   compared range are written to `pull_request_analyses.review_scope` at dispatch
   and recorded on the round at the callback.

2. **Partition the previous findings.** A finding is carried verbatim when its
   file is absent from the incremental diff *and* none of the round's changed
   exported symbols appears in its text. Everything else goes to the reviewer as
   `previous_blockers` to re-judge, which is the mechanism that already existed.

3. **Review the push, not the pull request.** The incremental diff goes as
   `Request.Files`, with a `SCOPE:` line telling the reviewer the diff is one
   push — because "the diff does not touch X" is a conclusion it would otherwise
   draw about the pull request from a list that only ever described a commit
   range. Blast radius stays global, and the prompt says so outright: what is
   narrowed is what CHANGED, never where the reviewer may look.

4. **Merge the finding lists.** `CarryForward.mergeRound` produces *carried +
   re-judged + newly found*, as **one list in `result.findings`** — because that
   is what `MergeGate` counts and what the panel renders. A carried finding
   living in a side channel would be invisible to both, which is the failure this
   whole document is about. This step is pure, testable, and the highest-risk
   part of the change; its tests were written first.

5. **Record the commits** the round covered — sha, subject, author, timestamp.

Merge rules worth knowing:

- A finding the reviewer **did** report wins over the carried copy. It was
  actually looked at, so it keeps the fresher line and the fresher provenance.
- A reviewer that reports the same defect twice under two wordings does not make
  the gate count two.
- On a **degraded** round, re-judged blockers the reviewer never spoke about are
  put **back**. A completed round's silence about a blocker is a judgement — it
  read the file. A partial round's silence is an absence, and dropping a blocker
  on it would be the same fail-open in a new place.

---

## Provenance, and why not an event log

Rounds store the **full findings list** per round, so "show me the review as it
stood at round 2" is one row read and every round is self-contained.
Reconstruction is free.

Replacing that with a delta log that replays would be worse in three ways:
reconstruction stops being free and every read path needs a cache (which is a
snapshot, so both end up stored); one bad round poisons every state after it,
with no point at which the pipeline can self-correct; and the delta is already
derivable from two adjacent snapshots by `diffRounds`, so storing it too means
storing a second copy that will eventually disagree. Storage is not the argument
either way — a findings list is a few KB.

But there **is** information snapshots cannot reconstruct, and incremental review
is what creates it:

> Was this finding **re-verified** this round, or **carried forward** without
> anyone looking?

Two adjacent snapshots both containing the same finding are indistinguishable.
Once the reviewer stops reading every file, that distinction is the difference
between a live finding and an assumption. So each finding carries provenance,
inside the snapshot (`PrFinding.provenance`):

| Field | Meaning |
| --- | --- |
| `firstSeenRound` | The round that first reported it. |
| `lastVerifiedRound` | The last round that actually read the code. |
| `carried` | This round inherited it without examining it. |
| `resolvedBy` | The commit whose round dropped it. |

`firstSeenRound` is exact where a stored stamp exists and otherwise dates to the
oldest round in the read window — a floor ("at least this old"), not a guess.

`resolvedBy` is stamped on findings in the round's **`resolved`** column, never on
a live one: a resolved blocker has to leave `result.findings` or fixing it would
never open the merge, and it has to stay readable or the round selector could not
show what a push fixed.

Stamping happens on **full** rounds too, where nothing is carried. The stamps are
what make a later round's "N carried" chip mean anything, and a full round that
skipped them would leave a hole in the history at the one point it is most
trustworthy.

---

## The surfaces

The two surfaces get **different** treatments, because they are read in different
places for different reasons.

### The comment: the latest review, and nothing else

The GitHub comment shows the current review, edited in place, with the progress
line above it — *"3 of 5 blockers resolved, 2 remain"* — and one collapsed
section naming the commits the round covered. **No round table.** The one that
used to be there is gone.

That is a deliberate simplification. A pull-request comment is read on a phone,
in a notification, between other things; the question it has to answer is "what
do I have to fix now". History belongs where it can be navigated, and a collapsed
table in a comment is neither the latest review nor a usable archive.

An incremental round says so, and says how many findings rode along:

```
Reviewed this push · 1
  063dc1e  fix(console): validate the saved-view name on the read route too · phongpak
  11 findings carried forward from an earlier round — their files were not touched by this push.
```

Stated rather than hidden: without it a cheap round looks like a lazy one and the
reader has no way to tell the difference. A **full** round says nothing about
carrying — a "0 carried" would read as an apology.

A link to the round in the app carries anyone who wants more.

### The panel: versioned, and switchable

The app is where history lives, because it is the only surface that can be
interactive. The round strip is a **selector**: choosing a round renders the
review exactly as it stood at that head — its verdict, its score, its findings,
including the ones later fixed.

```
Round 1        Round 2        Round 3  ●current
8ecc02a        45e02d1        063dc1e
5 blockers     3 blockers     3 blockers · 11 carried
feat: saved…   fix: name val… fix(console): validate…
```

Selecting round 1 shows five blockers, two of which no longer exist. That is the
point: a reader can see what the review said before their fix, which is the only
way to check that the fix addressed what was actually reported rather than what
they remembered being reported. An archive banner says so out loud, because a
stale review rendered without a frame around it is how somebody acts on a blocker
that was fixed two pushes ago.

**This is free, and it is why rounds store snapshots.** Each round already holds
its complete findings list, so the switcher is a row read — no replay, no
reconstruction, no risk of a rendered history that disagrees with what the gate
saw at the time. Had rounds stored deltas, this feature would have required
building the replay engine that section argues against.

The snapshot view is deliberately thinner than the live review: a round stores
its verdict, score and findings, not the narrative blocks around them. Rendering
a summary there would mean either storing a second copy of the whole result or
reconstructing prose nobody wrote, and the question that view answers — "what did
the review say I had to fix" — the findings answer on their own.

The `11 carried` chip expands to which findings were carried, when each was last
verified, and the rule that made carrying them safe.

---

## The deploy order, and what happens if it is wrong

The analyser decodes `/pr/analyse` with `DisallowUnknownFields`, so a cell that
predates `carried_findings` / `review_scope` **rejects** a request carrying them —
a 400, not a field it ignores. The analyser therefore deploys first.

If it does not, the tracker does not wedge. An incremental dispatch that is
refused is retried **once** as the review we would have run before any of this
existed: the whole pull request, no new fields, nothing carried, recorded as
`dispatch_refused`. The row's carried list is rewritten to empty *before* the
retry — a row still claiming to carry eleven findings the retry never sent would
put them back into a review that did not look at them, and label them verified.

The fallback is strictly **more** review, which is the only direction a fallback
in this pipeline is allowed to go. The same is true of every other failure in the
new machinery: a provider that cannot compare, a truncated compare, an
unreadable round history — each one leaves the round FULL, which is where every
round was before this existed.

---

## Decisions taken

**Stale carried findings** — a carried finding is re-judged when a changed
exported symbol appears in its text, not only when its file changes. See the
carry rule above. Errs toward re-judging, which costs a call rather than a missed
defect.

**Where history lives** — the comment shows only the latest review; the panel
carries the versioning. Different surfaces, different jobs.

**Fixed findings stay visible** — through the round selector rather than the
current findings list. A resolved blocker leaves `result.findings`, so the merge
gate stays clean, and remains readable at the round that reported it and in the
`resolved` column of the round that closed it. `resolvedBy` names the commit.

**How the reviewer is told what it is NOT reviewing** — it is handed the carried
findings as a short list (file, line, title, capped at 20) under the heading
`ALREADY REPORTED — do NOT re-report, do NOT open`.

This was the open question, and the resolution turns on a distinction the
`previous_blockers` work already established: the list REMOVES work rather than
adding it. Without it the reviewer walks the graph into an untouched file,
rediscovers a defect the last round already found, and spends one of nine turns
reporting a duplicate the merge then has to reconcile. Naming the finding costs
one line and buys that turn back. The reviewer is explicitly *not* told the
carried findings are correct — only that they are not its job — so the one thing
worth a turn stays available: if it opens such a file for a different reason and
finds the finding is now wrong, it is asked to say so.

The same note goes to the **reduce** pass, not only the review pass. Reduce's
draft is the total fallback when the review pass exhausts its turn ceiling, so a
reducer that thinks a push is the whole pull request produces the answer that
ships on exactly the runs where nothing else checked it — and one that does not
know about the carried findings would report them a second time.

**The saturation rule needs an absolute floor, not just a fraction** — measured,
not guessed. On MR !4 a round carried 2 of 2 findings, hit 100% saturation, and
forced the next round full. Two findings riding along is not a review made of
assumptions, and how long they may ride is already bounded by the rounds-since-full
rule. Without a floor, any pull request whose findings sit in files the pushes do
not touch alternates full/incremental forever and never gets two cheap rounds in
a row — most of the benefit, spent on a rule meant to protect it. The fraction now
applies only once at least four findings are carried.

**The merge owns the headline, not just the list** — also measured. The first
incremental round that worked returned verdict `approve`, score 10/10, "no errors
or risks found", over a findings list the tracker had just carried a CRITICAL
into. The analyser derives its verdict from the findings it raised, and on an
incremental round those are only the push's. The gate held — it counts
`result.findings` — so the strip correctly said "1 blocker" while every
human-facing signal said the pull request was clean. The verdict is re-derived
over the stored list (a blocker means changes requested, and `verdict_reason` is
replaced with it), and the score is FLOORED by the score of the round each carried
finding was last verified in. Floored rather than recomputed: the formula lives in
the analyser and a second copy here would be one more thing to drift.

**The delta's pairing** — a completing run saves its result and *then* appends a
round for the same head, so the newest round IS the current review. The panel was
diffing the review against itself, which made the progress line permanently read
"nothing fixed" on the one surface whose entire job is to say what the last push
changed. The route now pairs against the newest round whose head differs.

---

## Still open

**Whether round 1 of a PR should ever be incremental.** It cannot be, by the
scope rules. But a PR opened with fifty commits already on the branch gets one
enormous first round, and nothing here makes that better.

**Whether the thresholds are right.** 25 dependents, 4 rounds, 75%-and-4 carried. Every
round logs the rule that fired and every round records its scope, so
`pr_rounds_scope_idx` answers "how often does incremental actually happen, and
which rule blocks it?" over real traffic. Tune from that, not from this
paragraph.

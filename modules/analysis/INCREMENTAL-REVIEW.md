# Incremental review — plan

Review the push, carry the rest, and let the reader see which commit changed what.

This is a **plan, not a description**: rounds (migration 0080) are built and the
rest of this is not. It exists so the next person to open the PR-review pipeline
finds the reasoning rather than re-deriving it, and so the parts that look like
easy wins but are correctness bugs are marked as such before somebody ships one.

---

## Where this starts

Every push re-reviews the entire pull request. `listPullRequestFiles(number)` is
GitHub's PR-files endpoint — the full `base…head` diff — and
`PullRequestAnalysisService.start` re-sends it verbatim on every round.

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

Full re-review is what prevents that today. It is not thoroughness for its own
sake; it is the thing that gives the reviewer a fair chance to re-find what it
found before.

A quiet version of this already ships: `previous_blockers` **asks** the reviewer
whether each earlier blocker is fixed, but nothing **carries** them. If the model
says nothing about one, it disappears. The full diff is currently masking that.

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

### Testing the symbol, concretely

`PrFinding` carries no symbol field — only `file`, `line`, `title`, `detail` and
`evidence` anchors. So the test is a text match, and it should stay one:

> A carried finding is **re-judged** when any exported symbol name from
> `factscan.changedExported()` appears in its title or detail.

Deterministic, tracker-side, no model, no graph round trip. It over-triggers on
short or common names — a changed `get` would re-judge half the list — which
costs a re-judgement rather than a missed defect, so the failure direction is
right. If the over-triggering turns out to be expensive, the fix is a minimum
name length before the test applies, not a cleverer matcher.

---

## Deciding the scope — rules, not a model

The scope decision is **rule-based on purpose**. Build this first, log the
decision and its reason on every round, and only revisit it with real numbers.

Take the **full** review when any of these hold:

| Condition | Why |
| --- | --- |
| No previous round | Nothing to carry. |
| Previous round was `degraded` | A partial review is not a baseline. Carrying from one would manufacture the appearance of progress. |
| Last reviewed head is **not an ancestor** of this head | Force-push or rebase: the relationship between the two heads cannot be established, so nothing may be carried. |
| The base moved | `base…head` changed for reasons the push did not cause. |
| A **migration** is in the diff | Schema changes reach code the diff never mentions — see the `tasks.tenant_id` rename that broke `tasks-repo.ts` without appearing in it. |
| The **review profile changed** since the last round | Different lenses, different blocking bar. Round *n* was judged by a different reviewer than round *n−1*. |
| Changed symbols have **more than N dependents** in the graph | The "looks small, isn't" case. `factscan.changedExported` plus `get_neighbors` already answers this; it is a lookup, not an inference. |
| More than **M rounds** since the last full pass, or the carried fraction crosses a threshold | Bounds how long a finding can ride along unexamined, and gives the pipeline a way to recover from a bad baseline. |

Otherwise: incremental.

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

1. **Decide the scope** by the table above, and record the decision and its reason
   on the round.

2. **Partition the previous findings.** A finding is carried verbatim when its
   file is absent from the incremental diff *and* none of the round's changed
   exported symbols appears in its text. Everything else goes to the reviewer as
   `previous_blockers` to re-judge, which is the mechanism that already exists.

3. **Review the push, not the pull request.** Send the incremental diff as
   `Request.Files`, with the carried findings' files available to read but not
   presented as the change under review. Blast radius stays global: it walks the
   graph, so a changed public symbol still gets its callers enumerated across the
   whole repository.

4. **Merge the finding lists.** The stored review is *carried + re-judged + newly
   found*, as **one list in `result.findings`** — because that is what `MergeGate`
   counts and what the panel renders. A carried finding living in a side channel
   would be invisible to both, which is the failure this whole document is about.
   This step is pure, testable, and the highest-risk part of the change; write its
   tests first.

5. **Record the commits** the round covered — sha, subject, author, timestamp, and
   the files each touched.

---

## Provenance, and why not an event log

Rounds already store the **full findings list** per round, so "show me the review
as it stood at round 2" is one row read and every round is self-contained.
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
between a live finding and an assumption. So each finding gains provenance,
inside the snapshot:

| Field | Meaning |
| --- | --- |
| `firstSeenRound` | The round that first reported it. |
| `lastVerifiedRound` | The last round that actually read the code. |
| `carried` | This round inherited it without examining it. |
| `resolvedBy` | The commit whose round dropped it. |

That keeps reconstruction free, answers what a replay log would have been used
for, gives the "N carried" chip somewhere to expand into, and gives the
periodic-full-review rule its trigger.

It is also what makes the round selector below possible at all: switching to
round 2 renders round 2's stored snapshot, not a state rebuilt from a chain of
diffs that might have drifted from what the merge gate actually saw that day.

---

## The surfaces

The two surfaces get **different** treatments, because they are read in different
places for different reasons.

### The comment: the latest review, and nothing else

The GitHub comment shows the current review, edited in place, with the progress
line above it — *"3 of 5 blockers resolved, 2 remain"*. No round table, no
history.

That is a deliberate simplification. A pull-request comment is read on a phone,
in a notification, between other things; the question it has to answer is "what
do I have to fix now". History belongs where it can be navigated, and a collapsed
table in a comment is neither the latest review nor a usable archive.

A link to the round in the app carries anyone who wants more.

### The panel: versioned, and switchable

The app is where history lives, because it is the only surface that can be
interactive. The round strip becomes a **selector**: choosing a round renders the
review exactly as it stood at that head — its verdict, its score, its findings,
including the ones later fixed.

```
Round 1        Round 2        Round 3  ●current
8ecc02a        45e02d1        063dc1e
5 blockers     3 blockers     3 blockers · 11 carried
```

Selecting round 1 shows five blockers, two of which no longer exist. That is the
point: a reader can see what the review said before their fix, which is the only
way to check that the fix addressed what was actually reported rather than what
they remembered being reported.

**This is free, and it is why rounds store snapshots.** Each round already holds
its complete findings list, so the switcher is a row read — no replay, no
reconstruction, no risk of a rendered history that disagrees with what the gate
saw at the time. Had rounds stored deltas, this feature would have required
building the replay engine that section argues against.

The commit for each round sits under it, so the strip doubles as the series of
pushes:

```
Round 3  changes requested   3 blockers · 11 carried
  063dc1e  fix(console): validate the saved-view name on the read route too   1 file
```

The `11 carried` chip expands to which findings were carried, from which round,
and when each was last verified. Without that, a cheap round looks like a lazy
one and the reader has no way to tell the difference.

---

## What exists, what is new

| Piece | State |
| --- | --- |
| Round history (`pull_request_analysis_rounds`) | built — migration 0080 |
| Finding identity + delta (`ReviewRounds.ts`) | built — reused as-is for carry-forward |
| `previous_blockers` to the reviewer | built — becomes the re-judge half |
| Push coalescing (`pending_head_sha`) | built |
| Commit-range compare | **new** — the VCS layer has no compare API, only `listPullRequestFiles` |
| Commits recorded on the round | **new** |
| Scope decision + ancestry check | **new** — where the full-review fallback lives |
| Finding merge with provenance | **new** — pure, highest risk |
| Commit timeline in panel + comment | **new** |

The analyser needs almost nothing: `Request.Files` is already whatever the
tracker sends, so scoping is a tracker decision.

---

## Build order

Each step is useful alone, and none of it has to land at once.

1. **Commit-range compare + commits on the round.** Delivers the timeline with no
   behaviour change — every round is still full. Ships the UI value first and
   proves the compare plumbing before anything depends on it.
2. **Scope decision, logged but not acted on.** Every round records what it
   *would* have done and why. Gives real numbers on how often incremental is
   available before a single review changes.
3. **Carry-forward + finding merge**, behind the scope decision. The point of no
   return; the merge is what the gate reads.
4. **Provenance fields**, and the carried chip that expands.
5. **Periodic full review** on the round/fraction thresholds.

Steps 1 and 2 are safe by construction: neither changes what gets reviewed.

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
gate stays clean, and remains readable at the round that reported it. `resolvedBy`
names the commit that closed it.

---

## Still open

**How the reviewer is told what it is NOT reviewing.** Sending only the
incremental diff means the reviewer cannot see the carried findings' code unless
it opens the files. Whether the carried list should be summarised into the
context — and how that interacts with a nine-turn budget — is unresolved, and it
is the question most likely to decide whether incremental review is actually
cheaper in practice or merely differently expensive.

**Whether round 1 of a PR should ever be incremental.** It cannot be, by the
scope rules. But a PR opened with fifty commits already on the branch gets one
enormous first round, and nothing in this plan makes that better.

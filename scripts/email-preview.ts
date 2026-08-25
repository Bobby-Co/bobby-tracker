// Render every transactional email template to disk so they can be opened in a
// browser (and dragged into a real mail client) without sending anything.
//
// Why this script exists:
//   The templates are pure functions, but the only way they normally run is
//   inside a DB→app callback with a configured JMAP transport. That's a slow
//   loop for a change to a chip colour, and it means the "empty result" and
//   "no enrichment" variants — the ones most likely to look broken — are the
//   ones nobody ever looks at. This renders all of them, rich and degraded,
//   from fixtures.
//
// Run with:
//   bun scripts/email-preview.ts
//
// Writes .preview-emails/ (git-ignored) and prints the paths. Start at
// .preview-emails/index.html — it's a gallery of every template, with a
// light/dark switch, a phone/desktop width switch, and the plain-text
// alternative behind a toggle for each one.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { renderNotificationEmail, type NotificationEmailContext } from "@/modules/notifications"
import { renderFarewellEmail, renderWelcomeEmail } from "@/modules/account"
import { renderBetaAccessEmail, renderWaitlistJoinedEmail } from "@/modules/beta"
import { renderInviteEmail, renderRemovedFromTeamEmail, renderRoleChangedEmail } from "@/modules/teams"
import type { PrAnalysis, PullRequest } from "@/lib/shared/types"

const OUT_DIR = join(__dirname, "..", ".preview-emails")

const APP = "https://app.ucelot.dev"

const pull: PullRequest = {
    id: "pr-1",
    project_id: "proj-1",
    pr_number: 412,
    github_node_id: null,
    title: "Cache the analyser session bootstrap per isolate",
    body: "The JMAP session was re-bootstrapped on every send, which added two round trips to each notification. This caches it at module scope, the way the GitHub client already does, and adds a test for the expiry path.",
    state: "open",
    merged: false,
    draft: false,
    author_login: "phongpak",
    author_avatar_url: null,
    html_url: "https://github.com/bobby/tracker/pull/412",
    head_ref: "feat/jmap-session-cache",
    base_ref: "development",
    head_sha: null,
    base_sha: null,
    additions: 184,
    deletions: 37,
    changed_files: 6,
    comments_count: 3,
    gh_created_at: "2026-08-19T09:12:00Z",
    gh_updated_at: "2026-08-19T09:12:00Z",
    closed_at: null,
    merged_at: null,
    created_at: "2026-08-19T09:12:00Z",
    updated_at: "2026-08-19T09:12:00Z",
}

const analysis: PrAnalysis = {
    title: pull.title,
    summary:
        "The session cache is correct for the happy path and removes two round trips per send. Two problems block a merge: the cached session is never invalidated when the JMAP credentials rotate, so a token refresh leaves every isolate sending against a dead session until it recycles; and the expiry comparison uses the response's own clock rather than ours, which drifts.",
    impact:
        "Touches the send path of every transactional email — notifications, team invites and the internal callback all route through EmailTransport.send.",
    impact_files: [
        { file: "lib/server/email/EmailTransport.ts", reason: "the cache and its expiry live here" },
        { file: "modules/teams/infrastructure/JmapInviteNotifier.ts", reason: "sends through the cached session" },
    ],
    verdict: "request_changes",
    verdict_reason: "Credential rotation leaves a stale session cached for the life of the isolate.",
    score: 6,
    score_max: 10,
    findings: [
        {
            file: "lib/server/email/EmailTransport.ts",
            line: 148,
            severity: "critical",
            category: "bug",
            title: "Rotated credentials keep using the cached session",
            detail:
                "The cache key is the API URL alone, so a changed STALWART_JMAP_TOKEN reuses the session built with the old one. Every send then fails with 401 until the isolate recycles, and the failures are swallowed by the best-effort caller.",
        },
        {
            file: "lib/server/email/EmailTransport.ts",
            line: 161,
            severity: "critical",
            category: "bug",
            title: "Expiry is compared against the server's clock",
            detail: "expiresAt comes from the JMAP response but is compared to Date.now(), so any skew expires the session early or late.",
        },
        {
            file: "lib/server/email/EmailTransport.test.ts",
            line: 22,
            severity: "review",
            category: "test_gap",
            title: "No test covers a failed bootstrap",
            detail: "Both new tests take the success path; a rejected bootstrap should not poison the cache for later calls.",
        },
        {
            file: "modules/notifications/infrastructure/EmailChannel.ts",
            line: 40,
            severity: "review",
            category: "convention",
            title: "Reason strings aren't stable enough to log on",
            detail: "The delivery reason is the raw error message, so log filters key off wording that changes with the vendor.",
        },
    ],
    checklist: [
        "Rotate the JMAP token in staging and confirm the next send re-bootstraps.",
        "Send one notification and one invite after the change — both share the cache.",
        "Confirm a failed bootstrap doesn't leave a rejected promise cached.",
    ],
    checks: { precedents: 4, callers: 11, tests: 6, git_reads: 3, failure_probes: 2 },
    confidences: {
        correctness: { level: "high", basis: "read the cache, both call sites and the expiry maths" },
        load_perf: { level: "medium", basis: "no measurement of the saved round trips" },
        security: { level: "high", basis: "no credential is written to a log or a response" },
    },
    duration_ms: 148_000,
}

const base: Pick<NotificationEmailContext, "projectName" | "repoFullName"> = {
    projectName: "bobby-tracker",
    repoFullName: "bobby/tracker",
}

const CASES: { name: string; ctx: NotificationEmailContext }[] = [
    {
        name: "pr-review-rich",
        ctx: { ...base, kind: "pr_analysis_ready", url: `${APP}/projects/p1/pulls/412`, prNumber: 412, analysis, pull },
    },
    {
        // What the outbox channel can render: the score headline, no stored result.
        name: "pr-review-degraded",
        ctx: { ...base, kind: "pr_analysis_ready", url: `${APP}/projects/p1/pulls/412`, prNumber: 412, score: 9, scoreMax: 10 },
    },
    {
        name: "pr-review-approved",
        ctx: {
            ...base,
            kind: "pr_analysis_ready",
            url: `${APP}/projects/p1/pulls/412`,
            prNumber: 412,
            pull,
            analysis: { ...analysis, verdict: "approve", verdict_reason: "Nothing blocking; the two notes are follow-ups.", score: 9, findings: analysis.findings?.slice(2) },
        },
    },
    { name: "pr-opened", ctx: { ...base, kind: "pr_opened", url: `${APP}/projects/p1/pulls/412`, prNumber: 412, pull } },
    { name: "pr-opened-degraded", ctx: { ...base, kind: "pr_opened", url: `${APP}/projects/p1/pulls/412`, prNumber: 412 } },
    { name: "kb-ready", ctx: { ...base, kind: "kb_ready", url: `${APP}/projects/p1` } },
    { name: "kb-updated", ctx: { ...base, kind: "kb_updated", url: `${APP}/projects/p1` } },
    {
        name: "kb-failed",
        ctx: {
            ...base,
            kind: "kb_failed",
            url: `${APP}/projects/p1`,
            reason: "clone failed: remote end hung up unexpectedly (github.com/bobby/tracker, 403 after 2 retries)",
        },
    },
    { name: "kb-failed-no-reason", ctx: { ...base, kind: "kb_failed", url: `${APP}/projects/p1`, reason: null } },
    {
        name: "fallback",
        ctx: {
            ...base,
            kind: "something_new" as NotificationEmailContext["kind"],
            url: `${APP}/projects/p1`,
            fallbackTitle: "A kind this build has no template for",
            fallbackMeta: "bobby-tracker · PR #412",
        },
    },
]

// Everything that isn't a notification kind: the account lifecycle, the beta
// gate, and the three team mails. They render through the same shell, so they
// belong in the same eyeball pass.
const OTHERS: { name: string; group: string; mail: { subject: string; html: string; text: string } }[] = [
    { name: "welcome", group: "Account", mail: renderWelcomeEmail({ to: "ada@example.com", name: "Ada Lovelace", teamName: "Bobby Products" }) },
    { name: "welcome-no-name", group: "Account", mail: renderWelcomeEmail({ to: "ada@example.com", name: null, teamName: null }) },
    {
        name: "farewell",
        group: "Account",
        mail: renderFarewellEmail({
            to: "ada@example.com",
            name: "Ada Lovelace",
            teamsDeleted: ["Bobby Products", "Ada's Team"],
            teamsLeft: ["Analytical Engines"],
        }),
    },
    // A different address on purpose: the farewell's closing line is seeded by
    // the recipient, so two fixtures show that it varies.
    { name: "farewell-minimal", group: "Account", mail: renderFarewellEmail({ to: "grace@example.com", name: null, teamsDeleted: [], teamsLeft: [] }) },
    { name: "beta-waitlist-joined", group: "Beta", mail: renderWaitlistJoinedEmail({ to: "ada@example.com", name: "Ada Lovelace" }) },
    { name: "beta-access-granted", group: "Beta", mail: renderBetaAccessEmail({ to: "ada@example.com", note: "design partner" }) },
    { name: "team-invite", group: "Teams", mail: renderInviteEmail({ to: "dev@example.com", teamName: "Bobby Products", inviterName: "phongpak", acceptUrl: `${APP}/invites/9f2c1ab4`, role: "admin" }) },
    { name: "team-invite-anonymous", group: "Teams", mail: renderInviteEmail({ to: "dev@example.com", teamName: "Bobby Products", inviterName: null, acceptUrl: `${APP}/invites/9f2c1ab4`, role: "member" }) },
    { name: "team-role-promoted", group: "Teams", mail: renderRoleChangedEmail({ to: "dev@example.com", name: "Ada Lovelace", teamName: "Bobby Products", previous: "member", current: "admin", actorName: "phongpak" }) },
    { name: "team-role-demoted", group: "Teams", mail: renderRoleChangedEmail({ to: "dev@example.com", name: "Ada Lovelace", teamName: "Bobby Products", previous: "admin", current: "member", actorName: "phongpak" }) },
    { name: "team-removed", group: "Teams", mail: renderRemovedFromTeamEmail({ to: "dev@example.com", name: "Ada Lovelace", teamName: "Bobby Products", actorName: "phongpak" }) },
]

/** Which section of the gallery a notification case belongs in. */
function groupOf(name: string): string {
    if (name.startsWith("pr-review")) return "Pull request reviews"
    if (name.startsWith("pr-opened")) return "Pull requests"
    if (name.startsWith("kb-")) return "Knowledge base"
    return "Fallback"
}

/** Every template this app can send, rendered. The single list both the file
 *  writer and the server work from. */
export function renderAll(): { name: string; group: string; mail: { subject: string; html: string; text: string } }[] {
    return [
        ...CASES.map(({ name, ctx }) => ({ name, group: groupOf(name), mail: renderNotificationEmail(ctx) })),
        ...OTHERS,
    ]
}

/** The gallery page. Exported so scripts/email-preview-serve.ts can render it
 *  fresh per request rather than serving a stale file. */
export function renderGallery(): string {
    return gallery(renderAll())
}

// Writing to disk is what you get by RUNNING this file; importing it (which the
// server does) must have no side effects. `import.meta.main` would say this more
// directly, but it isn't in the repo's TS lib, and argv is exact enough.
if ((process.argv[1] ?? "").endsWith("email-preview.ts")) {
    const rendered = renderAll()
    mkdirSync(OUT_DIR, { recursive: true })
    for (const { name, mail } of rendered) {
        writeFileSync(join(OUT_DIR, `${name}.html`), mail.html)
        writeFileSync(join(OUT_DIR, `${name}.txt`), `Subject: ${mail.subject}\n\n${mail.text}`)
    }
    writeFileSync(join(OUT_DIR, "index.html"), gallery(rendered))
    for (const { group, name, mail } of rendered) {
        console.log(`${group.padEnd(22)} ${name.padEnd(24)} ${mail.subject}`)
    }
    console.log(`\n${rendered.length} templates → ${join(OUT_DIR, "index.html")}`)
    console.log(`Live-reloading server:  bun scripts/email-preview-serve.ts`)
}

// ─── the gallery ────────────────────────────────────────────────────────────
// One page, every template, side by side. Each mail renders in its own IFRAME,
// which is the point: an iframe is a real viewport, so the shell's `max-width`
// and its `@media (max-width:620px)` rules resolve against the frame rather than
// the gallery. That makes the phone toggle an honest test rather than a CSS
// illusion — and it keeps each mail's own styles from leaking into this page.
function gallery(items: { name: string; group: string; mail: { subject: string; html: string; text: string } }[]): string {
    const groups = [...new Set(items.map((i) => i.group))]
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)

    const sections = groups
        .map((g) => {
            const cards = items
                .filter((i) => i.group === g)
                .map(
                    (i) => `
        <article class="card" id="${esc(i.name)}">
          <header>
            <div class="name">${esc(i.name)}</div>
            <div class="subject"><span>Subject</span>${esc(i.mail.subject)}</div>
          </header>
          <div class="frame">
            <iframe title="${esc(i.name)}" srcdoc="${esc(i.mail.html)}" loading="lazy"></iframe>
          </div>
          <details>
            <summary>Plain-text alternative (${i.mail.text.length} chars)</summary>
            <pre>${esc(i.mail.text)}</pre>
          </details>
        </article>`,
                )
                .join("")
            return `<section><h2>${esc(g)}</h2><div class="grid">${cards}</div></section>`
        })
        .join("")

    const nav = items.map((i) => `<a href="#${esc(i.name)}">${esc(i.name)}</a>`).join("")

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ucelot email templates</title>
<style>
  :root { --bg:#f1efec; --panel:#fff; --line:#e3e0dc; --ink:#1f2430; --dim:#6b7280; --ember:#e9730f; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:400 14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  header.top { position:sticky; top:0; z-index:5; background:#0a0d1c; color:#fff; padding:14px 22px; display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
  header.top h1 { font-size:15px; margin:0; font-weight:600; letter-spacing:-.01em; }
  header.top .count { color:#8b93ad; font-size:13px; }
  .controls { margin-left:auto; display:flex; gap:8px; }
  button { background:#1a1f36; color:#dfe3ee; border:1px solid #2b3252; border-radius:8px; padding:7px 13px; font:600 12.5px/1 inherit; cursor:pointer; }
  button[aria-pressed="true"] { background:var(--ember); border-color:var(--ember); color:#fff; }
  nav { padding:12px 22px; background:var(--panel); border-bottom:1px solid var(--line); display:flex; gap:6px; flex-wrap:wrap; }
  nav a { font-size:12px; color:var(--dim); text-decoration:none; border:1px solid var(--line); border-radius:999px; padding:4px 10px; }
  nav a:hover { color:var(--ember); border-color:var(--ember); }
  section { padding:26px 22px 6px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.1em; color:var(--dim); margin:0 0 14px; }
  .grid { display:flex; flex-wrap:wrap; gap:20px; align-items:flex-start; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; overflow:hidden; width:max-content; max-width:100%; }
  .card header { padding:13px 16px; border-bottom:1px solid var(--line); }
  .name { font:600 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--ember); }
  .subject { margin-top:5px; font-size:12.5px; color:var(--dim); max-width:640px; }
  .subject span { display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.08em; margin-right:7px; color:#a3a8b0; }
  .frame { padding:14px; background:#e9e6e2; }
  iframe { width:660px; height:760px; border:0; border-radius:8px; background:#fff; display:block; transition:width .18s ease; }
  body.phone iframe { width:390px; }
  details { border-top:1px solid var(--line); }
  summary { padding:10px 16px; font-size:12.5px; color:var(--dim); cursor:pointer; }
  pre { margin:0; padding:0 16px 16px; font:400 12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; color:#3f4654; max-width:660px; }
</style></head>
<body>
<header class="top">
  <h1>Ucelot email templates</h1>
  <span class="count">${items.length} templates &middot; bun scripts/email-preview.ts</span>
  <div class="controls">
    <button id="width" aria-pressed="false">Phone width</button>
    <button id="scheme" aria-pressed="false">Dark mode</button>
  </div>
</header>
<nav>${nav}</nav>
${sections}
<script>
  const widthBtn = document.getElementById("width")
  const schemeBtn = document.getElementById("scheme")

  widthBtn.onclick = () => {
    const on = document.body.classList.toggle("phone")
    widthBtn.setAttribute("aria-pressed", String(on))
    widthBtn.textContent = on ? "Desktop width" : "Phone width"
  }

  // The mails carry their own \`prefers-color-scheme\` rules, and an iframe
  // inherits the top-level preference — which this page cannot change. So dark
  // mode is applied by REPLAYING the mail's own @media (prefers-color-scheme:dark)
  // block as plain rules inside each frame. Same declarations, same selectors,
  // just without the media query gating them.
  let dark = false
  schemeBtn.onclick = () => {
    dark = !dark
    schemeBtn.setAttribute("aria-pressed", String(dark))
    schemeBtn.textContent = dark ? "Light mode" : "Dark mode"
    document.querySelectorAll("iframe").forEach((f) => {
      const doc = f.contentDocument
      if (!doc) return
      let patch = doc.getElementById("__dark")
      if (!dark) { patch?.remove(); return }
      if (patch) return
      const rules = [...doc.styleSheets]
        .flatMap((sheet) => { try { return [...sheet.cssRules] } catch { return [] } })
        .filter((r) => r.conditionText && r.conditionText.includes("prefers-color-scheme: dark"))
        .flatMap((r) => [...r.cssRules].map((inner) => inner.cssText))
      patch = doc.createElement("style")
      patch.id = "__dark"
      // Joined with a space, not a newline: each cssText already ends in "}",
      // and a literal escape inside this nested template literal is one level of
      // quoting away from emitting a raw newline into the script tag.
      patch.textContent = rules.join(" ")
      doc.head.appendChild(patch)
    })
  }
</script>
</body></html>`
}

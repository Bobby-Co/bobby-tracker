// The email DESIGN SYSTEM — the one branded shell every transactional mail in
// the app is rendered into, plus the block primitives a template composes its
// body from.
//
// It exists because an email is not a page. There is no stylesheet, no class
// system, and the lowest-common-denominator renderer is Microsoft Word (Outlook
// on Windows uses the Word engine, not a browser). So the choice is either a
// shared vocabulary of blocks that already know the rules, or the same fragile
// markup copy-pasted into every sender and drifting apart. This is the shared
// vocabulary.
//
// ─── WHAT THIS FILE DELIBERATELY NEVER EMITS ────────────────────────────────
// Not a style preference — each of these is silently dropped by at least one
// major client, and a layout that depends on it collapses into a single
// unreadable column:
//   - `display:flex` / `display:grid` and every property that belongs to them.
//     Outlook's Word engine supports NEITHER. Multi-column layout here is
//     always nested tables — that is the only construct with real support.
//   - `float`, `position`, `z-index`, `transform`, `calc()`.
//   - the `font:` SHORTHAND. Outlook.com rewrites/strips shorthand declarations,
//     which drops the whole rule and leaves the mail in Times New Roman. Every
//     text style here is longhand, via textStyle().
//   - background images, remote fonts, remote CSS, <script>, and any other
//     subresource. The ONE exception is the brand mark in the header, which no
//     other technique can render at all (see brandBar) — and it is built to
//     degrade to a plain ember tile when a client blocks it.
//   - unitless line-heights. They're computed to px with
//     `mso-line-height-rule:exactly`, because Word rounds them its own way.
//
// ─── WHAT IT DOES INSTEAD ───────────────────────────────────────────────────
//   - tables for every layout decision, `role="presentation"` so screen readers
//     skip the scaffolding, with the mso lspace/rspace reset on each one;
//   - styles INLINE on the element. The <style> block carries dark mode and the
//     small-screen rules ONLY — it is progressive polish, never load-bearing,
//     because Gmail's clipped view and several webmail clients drop it;
//   - HTML presentational attributes (`bgcolor`, `width`, `align`, `valign`)
//     ALONGSIDE the CSS, since Word honours the attribute and ignores the rule;
//   - an mso ghost table around the content column, because Outlook ignores
//     `max-width` and would otherwise stretch the mail to the window;
//   - every human- or repo-supplied string escaped on the way in.
//
// Colours are the app's own tokens (app/globals.css): Ucelot ember on midnight,
// on the warm shell cream. Kept as literals because an email can't read a CSS
// variable — change one there, change it here.
//
// Pure presentation: no I/O, no SDK, no framework. A sender builds blocks, hands
// them to renderEmail(), and passes the result to EmailTransport.

/** The brand palette, mirrored from app/globals.css `:root`. */
export const EMAIL_THEME = {
    page: "#f1efec",        // --c-shell, the warm "desk" the card floats on
    surface: "#ffffff",     // --c-surface
    surfaceAlt: "#f7f7f8",  // --c-surface-2
    border: "#ececef",      // --c-border
    borderStrong: "#dcdfe4",// --c-border-strong
    ink: "#1f2430",         // --c-text
    body: "#3f4654",        // body copy, one step off --c-text
    muted: "#6b7280",       // --c-text-muted
    dim: "#a3a8b0",         // --c-text-dim
    ember: "#e9730f",       // --c-primary
    emberDeep: "#c2410c",   // --c-accent
    emberTint: "#fff3e6",   // --c-primary-tint
    midnight: "#0a0d1c",    // --c-secondary
    midnightDeep: "#090c1c",// --c-secondary-deep
    font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
    mono: "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace",
} as const

/** Semantic tones. The vocabulary matches the in-app chips (badge.ts) so a
 *  finding that reads rose in the app doesn't read amber in the mail. */
export type EmailTone = "ember" | "positive" | "warning" | "critical" | "info" | "neutral"

const TONE: Record<EmailTone, { bg: string; fg: string; solid: string }> = {
    ember:    { bg: "#fff3e6", fg: "#9a3412", solid: "#e9730f" },
    positive: { bg: "#ecfdf5", fg: "#047857", solid: "#10b981" },
    warning:  { bg: "#fffbeb", fg: "#b45309", solid: "#f59e0b" },
    critical: { bg: "#fff1f2", fg: "#be123c", solid: "#f43f5e" },
    info:     { bg: "#eff6ff", fg: "#1d4ed8", solid: "#3b82f6" },
    neutral:  { bg: "#f4f4f5", fg: "#52525b", solid: "#a1a1aa" },
}

/** Reset emitted on EVERY table: Word adds its own spacing around tables, and
 *  these two properties are the only way to take it back. */
const T_RESET = "border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;"
/** For tables that carry a border-radius — `collapse` suppresses the radius in
 *  several clients, `separate` keeps it (and degrades to a square in Word). */
const T_RESET_SEP = "border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt;"

export interface EmailChip {
    label: string
    tone?: EmailTone
}

export interface EmailAction {
    label: string
    url: string
}

export interface EmailDocumentInput {
    /** The line mail clients show after the subject in the inbox list. Rendered
     *  invisibly at the top of the body — without it clients scrape whatever
     *  text comes first, which is the eyebrow and reads as noise. */
    preheader: string
    /** Small uppercase label above the heading — which kind of mail this is. */
    kicker: string
    heading: string
    subheading?: string | null
    chips?: EmailChip[]
    /** Pre-rendered blocks (see the primitives below), in order. */
    blocks?: string[]
    action?: EmailAction | null
    /** An optional lower-emphasis second action, rendered as a plain link. */
    secondary?: EmailAction | null
    /** An extra line above the standard "why am I getting this" footer. */
    footerNote?: string | null
}

// ─── type ────────────────────────────────────────────────────────────────────

/** Build a LONGHAND text style. Never emit the `font:` shorthand — see the file
 *  header. Line-height is given as a multiplier and resolved to px, because Word
 *  needs `mso-line-height-rule:exactly` and that only means something in px. */
function textStyle(v: {
    size: number
    lh: number
    weight?: number
    color?: string
    family?: string
    track?: string
    upper?: boolean
}): string {
    const lh = Math.round(v.size * v.lh)
    return (
        `font-family:${v.family ?? EMAIL_THEME.font};` +
        `font-size:${v.size}px;` +
        `line-height:${lh}px;` +
        `mso-line-height-rule:exactly;` +
        `font-weight:${v.weight ?? 400};` +
        (v.color ? `color:${v.color};` : "") +
        (v.track ? `letter-spacing:${v.track};` : "") +
        (v.upper ? "text-transform:uppercase;" : "")
    )
}

// ─── the shell ───────────────────────────────────────────────────────────────

/** Render a complete HTML email document. */
export function renderEmail(doc: EmailDocumentInput): string {
    const t = EMAIL_THEME
    const chips = doc.chips?.length ? chipRow(doc.chips) : ""
    const body = (doc.blocks ?? []).filter(Boolean).join("")

    const cta = doc.action
        ? `<tr><td class="px" style="padding:26px 36px 0 36px;">${button(doc.action)}</td></tr>`
        : ""
    const secondary = doc.secondary
        ? `<tr><td class="px" style="padding:14px 36px 0 36px;${textStyle({ size: 13, lh: 1.6, color: t.muted })}">` +
          `<a href="${esc(doc.secondary.url)}" style="${textStyle({ size: 13, lh: 1.6, weight: 600, color: t.emberDeep })}text-decoration:none;">${esc(doc.secondary.label)}</a>` +
          `</td></tr>`
        : ""

    // The raw URL under the button: some clients (and every text-mode reader)
    // won't render the button, and a mail whose only route into the app is a
    // styled <a> is a mail that can dead-end.
    const fallback = doc.action
        ? `<tr><td class="px" style="padding:18px 36px 0 36px;${textStyle({ size: 12, lh: 1.6, color: t.dim })}word-break:break-all;overflow-wrap:anywhere;">` +
          `Button not working? Paste this into your browser:<br><span style="color:${t.muted};">${esc(doc.action.url)}</span></td></tr>`
        : ""

    return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(doc.heading)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  /* Progressive polish ONLY. Every rule here has an inline equivalent, so a
     client that strips <style> — Gmail's clipped view, several webmail apps —
     still gets the intended light-mode design at full width. */
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0; padding:0; width:100%; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  a { text-decoration:none; }
  @media only screen and (max-width:620px) {
    .px { padding-left:22px !important; padding-right:22px !important; }
    .h1 { font-size:22px !important; line-height:29px !important; }
    /* Stacking is done by turning table cells into blocks — the table-based
       equivalent of a responsive column, and the only one Word can ignore
       harmlessly (it never sees the media query). */
    .stack { display:block !important; width:100% !important; }
    /* The fixed height only exists to level cards side by side; stacked, it is
       dead space. */
    .statcell { height:auto !important; }
  }
  @media (prefers-color-scheme: dark) {
    .page    { background:${t.midnightDeep} !important; }
    .card    { background:#12162a !important; border-color:#242a44 !important; }
    .ink     { color:#eceef5 !important; }
    .muted   { color:#a8aec2 !important; }
    .dim     { color:#7f869c !important; }
    .rule    { border-color:#242a44 !important; }
    .panel   { background:#1a1f36 !important; border-color:#2b3252 !important; }
    .panel-ink { color:#eceef5 !important; }
    .track   { background:#2b3252 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background:${t.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(doc.preheader)}</div>
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.page}" style="${T_RESET}background:${t.page};">
  <tr><td align="center" style="padding:32px 12px 40px 12px;">
    <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.surface}" style="${T_RESET_SEP}width:100%;max-width:600px;background:${t.surface};border:1px solid ${t.border};border-radius:18px;">

      ${brandBar()}

      <tr><td class="px" style="padding:30px 36px 0 36px;">
        <div class="dim" style="${textStyle({ size: 11, lh: 1, weight: 700, color: t.emberDeep, track: ".1em", upper: true })}">${esc(doc.kicker)}</div>
        <h1 class="h1 ink" style="margin:12px 0 0 0;${textStyle({ size: 26, lh: 1.28, weight: 700, color: t.ink, track: "-.02em" })}">${esc(doc.heading)}</h1>
        ${doc.subheading ? `<div class="muted" style="margin-top:8px;${textStyle({ size: 14, lh: 1.5, color: t.muted })}">${esc(doc.subheading)}</div>` : ""}
      </td></tr>

      ${chips ? `<tr><td class="px" style="padding:18px 36px 0 36px;">${chips}</td></tr>` : ""}
      ${body}
      ${cta}
      ${secondary}
      ${fallback}

      ${footer(doc.footerNote ?? null)}
    </table>
    <!--[if mso]></td></tr></table><![endif]-->

    <div class="dim" style="width:100%;max-width:600px;margin-top:18px;${textStyle({ size: 12, lh: 1.6, color: t.dim })}text-align:center;">
      Ucelot &middot; your codebase, understood.
    </div>
  </td></tr>
</table>
</body>
</html>`
}

// The midnight band at the top of every mail: the one place the brand asserts
// itself, so the templates below never have to.
//
// This carries the ONLY <img> in the whole design system, and it is a deliberate
// exception to the no-subresources rule at the top of this file. The Bobby mark
// cannot be drawn any other way: inline <svg> is stripped by Gmail and by Word,
// and a data: URI image is blocked by both — a remote PNG is the only form of a
// real logo that any mail client will render.
//
// The cost, and it is a real one: several clients block images by default until
// the reader asks for them, and a blocked or failed <img> does NOT collapse to
// nothing — the client draws its own placeholder in the reserved box (verified:
// a 404 renders a broken-image glyph, not empty space). What the construction
// below buys is that the placeholder lands INSIDE the ember tile at the right
// size rather than punching a hole in the header: the tile is the table cell's
// own bgcolor so it paints with or without the image, the width/height are
// attributes so the box is reserved either way and the bar never reflows, and
// the alt text is empty because the wordmark beside it already reads "ucelot" —
// an alt of "Ucelot" would print the name twice.
//
// If that blocked state is ever judged worse than no mark, the fix is one line:
// drop `mark` below and the header falls back to the ember tile with a white
// lettermark, which is what it was before.
//
// The tile is a table cell with bgcolor/width/height attributes rather than a
// styled div, because those are the parts Word actually honours. The PNG is
// generated from components/layout/brand-lockup.tsx's BOBBY_MARK_PATH (the same
// source the app renders) by scripts/build-email-mark.ts, at 4× its display size
// so it stays crisp on a retina screen.
function brandBar(): string {
    const t = EMAIL_THEME
    const mark = appUrl("/email/ucelot-mark.png")
    // Falls back to the lettermark when there is no absolute base URL to build
    // the image's src from — a relative src in an email resolves to nothing.
    const glyph = mark
        ? `<img src="${esc(mark)}" width="18" height="17" alt="" style="display:block;width:18px;height:17px;border:0;outline:none;text-decoration:none;">`
        : "U"
    return `<tr><td bgcolor="${t.midnight}" style="background:${t.midnight};padding:20px 36px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${T_RESET_SEP}"><tr>
          <td width="28" height="28" bgcolor="${t.ember}" align="center" valign="middle" style="width:28px;height:28px;background:${t.ember};border-radius:9px;${textStyle({ size: 14, lh: 1, weight: 700, color: "#ffffff" })}">${glyph}</td>
          <td width="11" style="width:11px;font-size:0;line-height:0;">&nbsp;</td>
          <td valign="middle" style="${textStyle({ size: 16, lh: 1.75, weight: 600, color: "#ffffff", track: "-.01em" })}">ucelot</td>
        </tr></table>
      </td></tr>`
}

function footer(note: string | null): string {
    const t = EMAIL_THEME
    const settings = appUrl("/settings")
    // A SPACER ROW, not padding. Every block primitive pads only its top (see
    // row()), so the last one in a mail ends flush — and the footer's own
    // padding-top sits BELOW its border-top, where it can do nothing about the
    // rule hugging the last line of the body. This row is the gap.
    return `<tr><td style="height:34px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td class="px rule" style="padding:28px 36px 30px 36px;border-top:1px solid ${t.border};">
        ${note ? `<div class="dim" style="margin-bottom:10px;${textStyle({ size: 12, lh: 1.65, color: t.dim })}">${esc(note)}</div>` : ""}
        <div class="dim" style="${textStyle({ size: 12, lh: 1.65, color: t.dim })}">
          You're receiving this because you're on a Ucelot project that produced this update.
          ${settings ? `<a href="${esc(settings)}" style="color:${t.muted};text-decoration:underline;">Manage notifications</a>.` : ""}
        </div>
      </td></tr>`
}

// ─── block primitives ────────────────────────────────────────────────────────
// Each returns a complete <tr> so a template's body is just an ordered array.

/** Body copy. `lead` gives the first paragraph a touch more size. */
export function paragraph(text: string, opts?: { lead?: boolean; top?: number }): string {
    if (!text.trim()) return ""
    const t = EMAIL_THEME
    const style = opts?.lead
        ? textStyle({ size: 16, lh: 1.7, color: t.ink })
        : textStyle({ size: 15, lh: 1.7, color: t.body })
    return row(`<p class="${opts?.lead ? "ink" : "muted"}" style="margin:0;${style}">${esc(text).replace(/\n+/g, "<br>")}</p>`, opts?.top ?? 20)
}

/** A small uppercase section label — the seam between body sections. */
export function sectionTitle(text: string): string {
    const t = EMAIL_THEME
    return row(`<div class="dim" style="${textStyle({ size: 11, lh: 1, weight: 700, color: t.dim, track: ".09em", upper: true })}">${esc(text)}</div>`, 26)
}

/** A hairline rule. A bordered, empty table cell — a styled <hr> is one of the
 *  first things Word reinterprets. */
export function divider(): string {
    return row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${T_RESET}"><tr>` +
            `<td height="1" bgcolor="${EMAIL_THEME.border}" class="rule" style="height:1px;background:${EMAIL_THEME.border};font-size:0;line-height:0;">&nbsp;</td>` +
            `</tr></table>`,
        24,
    )
}

/** A tinted panel — the "here is the thing itself" block (a PR title, a summary
 *  the reviewer wrote, an excerpt). */
export function callout(v: { title?: string | null; body: string; tone?: EmailTone; mono?: boolean }): string {
    const t = EMAIL_THEME
    const tone = TONE[v.tone ?? "neutral"]
    const bg = v.tone && v.tone !== "neutral" ? tone.bg : t.surfaceAlt
    const border = v.tone && v.tone !== "neutral" ? tone.bg : t.border
    const title = v.title
        ? `<div class="panel-ink" style="margin-bottom:${v.body ? "8px" : "0"};${textStyle({ size: 15, lh: 1.45, weight: 600, color: t.ink })}">${esc(v.title)}</div>`
        : ""
    const body = v.body
        ? `<div class="muted" style="${textStyle({ size: 14, lh: 1.65, color: t.muted, family: v.mono ? t.mono : undefined })}">${esc(v.body).replace(/\n+/g, "<br>")}</div>`
        : ""
    return row(
        `<table role="presentation" class="panel" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="${T_RESET_SEP}background:${bg};border:1px solid ${border};border-radius:12px;">
           <tr><td style="padding:16px 18px;">${title}${body}</td></tr>
         </table>`,
        20,
    )
}

/** A row of status pills.
 *
 *  TWO renderings, chosen by the client:
 *   - everywhere else, inline-block spans. A chip must not wrap INSIDE itself,
 *     and a table row can't wrap BETWEEN cells, so a table gave four chips a
 *     ~590px minimum width and a horizontal scrollbar on a phone. Spans wrap
 *     between pills and keep each pill intact.
 *   - in Outlook (mso), a single table row. Word ignores both `inline-block`
 *     and margins on inline elements, so the spans would stack flush against
 *     each other. It can't wrap — but it doesn't need to: Word only ever
 *     renders this at the full 600px column, where the chips fit anyway. */
export function chipRow(chips: EmailChip[]): string {
    if (!chips.length) return ""

    // The dot needs BOTH `vertical-align:middle` and zeroed font metrics. An
    // inline-block whose content is in flow takes its baseline from that
    // content's last line box, so the &nbsp; inside a 6px box was being
    // baseline-aligned to the label and lifting the dot ~3.5px above the text's
    // centre — more than the dot's own height. font-size/line-height 0 removes
    // that line box; vertical-align:middle then centres the dot on the label's
    // x-height. The 1px bottom margin is the optical correction: middle aligns
    // to half the x-height, which sits slightly below the centre of a cap-height
    // string like "2 blockers".
    const spans = chips
        .map((c) => {
            const tone = TONE[c.tone ?? "neutral"]
            return (
                `<span style="display:inline-block;background:${tone.bg};border-radius:999px;padding:6px 12px;margin:0 6px 8px 0;` +
                `${textStyle({ size: 12, lh: 1.1, weight: 600, color: tone.fg })}white-space:nowrap;">` +
                `<span style="display:inline-block;vertical-align:middle;width:6px;height:6px;border-radius:3px;background:${tone.solid};margin:0 6px 1px 0;font-size:0;line-height:0;">&nbsp;</span>` +
                `${esc(c.label)}</span>`
            )
        })
        .join("")

    const cells = chips
        .map((c) => {
            const tone = TONE[c.tone ?? "neutral"]
            return (
                `<td bgcolor="${tone.bg}" style="background:${tone.bg};border-radius:999px;padding:6px 12px;` +
                `${textStyle({ size: 12, lh: 1.1, weight: 600, color: tone.fg })}white-space:nowrap;">&bull;&nbsp;${esc(c.label)}</td>` +
                `<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>`
            )
        })
        .join("")

    return (
        `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${T_RESET_SEP}"><tr>${cells}</tr></table><![endif]-->` +
        `<!--[if !mso]><!-->${spans}<!--<![endif]-->`
    )
}

/** Up to four headline numbers, side by side — nested table cells, not a grid.
 *  Falls to one per line under 620px via the `.stack` rule. */
export function statGrid(stats: { label: string; value: string; tone?: EmailTone }[]): string {
    const items = stats.filter((s) => s.value !== "")
    if (!items.length) return ""
    const t = EMAIL_THEME
    const width = Math.floor(100 / items.length)
    const cells = items
        .map(
            (s) => `<td class="stack" width="${width}%" valign="top" style="padding:0 8px 0 0;">
        <table role="presentation" class="panel" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.surfaceAlt}" style="${T_RESET_SEP}background:${t.surfaceAlt};border:1px solid ${t.border};border-radius:12px;margin-bottom:8px;">
          <tr><td class="statcell" height="64" valign="top" style="padding:13px 14px;">
            <div style="${textStyle({ size: 19, lh: 1.2, weight: 700, color: s.tone ? TONE[s.tone].fg : t.ink })}">${esc(s.value)}</div>
            <div class="dim" style="margin-top:4px;${textStyle({ size: 11, lh: 1.3, weight: 500, color: t.dim, track: ".04em", upper: true })}">${esc(s.label)}</div>
          </td></tr>
        </table></td>`,
        )
        .join("")
    return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${T_RESET}"><tr>${cells}</tr></table>`, 20)
}

/** A segmented progress bar — the merge-readiness headline, drawn the way the
 *  app draws it. One table cell per segment, so it needs no bar-width maths and
 *  no property Word would drop. */
export function meter(v: { label: string; value: number; max: number; tone?: EmailTone }): string {
    const t = EMAIL_THEME
    const max = Math.max(1, Math.min(v.max, 20))
    const filled = Math.max(0, Math.min(v.value, max))
    const tone = TONE[v.tone ?? "ember"]
    // The empty segments are the one element that has to be re-tinted for dark
    // mode — a light track on a dark card reads as a FULL bar.
    const seg = Array.from({ length: max }, (_, i) => {
        const fill = i < filled ? tone.solid : t.border
        return (
            `<td style="padding:0 3px 0 0;">` +
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${T_RESET_SEP}"><tr>` +
            `<td height="8" bgcolor="${fill}"${i < filled ? "" : ` class="track"`} style="height:8px;background:${fill};border-radius:4px;font-size:0;line-height:0;">&nbsp;</td>` +
            `</tr></table></td>`
        )
    }).join("")
    return row(
        `<div class="dim" style="margin-bottom:9px;${textStyle({ size: 11, lh: 1, weight: 500, color: t.dim, track: ".06em", upper: true })}">${esc(v.label)}</div>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${T_RESET}table-layout:fixed;"><tr>${seg}</tr></table>
         <div class="ink" style="margin-top:9px;${textStyle({ size: 15, lh: 1, weight: 700, color: t.ink })}">${v.value}<span class="dim" style="font-weight:500;color:${t.dim};">/${v.max}</span></div>`,
        22,
    )
}

/** One item in a bulleted list. The object form exists for `dim`: an item that
 *  belongs in the list — same marker, same alignment, same rhythm — but is not
 *  the same KIND of thing as the ones around it, and shouldn't be read as one. */
export type BulletItem = string | { text: string; dim?: boolean }

/** A labelled list — "verify before merge", "what you can do now". A marker
 *  cell beside a text cell, rather than <ul>, whose indentation and bullet
 *  glyph every client resets differently. */
export function bullets(items: BulletItem[], opts?: { marker?: string; tone?: EmailTone }): string {
    const list = items
        .map((i) => (typeof i === "string" ? { text: i, dim: false } : { text: i.text, dim: i.dim ?? false }))
        .filter((i) => i.text && i.text.trim())
    if (!list.length) return ""
    const t = EMAIL_THEME
    const tone = TONE[opts?.tone ?? "ember"]
    const rows = list
        .map(
            (i) => `<tr>
        <td valign="top" width="18" style="width:18px;padding:0 10px 9px 0;${textStyle({ size: 14, lh: 1.65, weight: 700, color: tone.solid })}">${esc(opts?.marker ?? "•")}</td>
        <td valign="top" class="${i.dim ? "dim" : "muted"}" style="padding:0 0 9px 0;${textStyle({ size: 14, lh: 1.65, color: i.dim ? t.dim : t.body })}word-break:break-word;overflow-wrap:break-word;">${esc(i.text)}</td>
      </tr>`,
        )
        .join("")
    return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${T_RESET}">${rows}</table>`, 16)
}

/** Label→value rows: branches, timing, cost — the small print of a mail. */
export function keyValues(rows: { label: string; value: string }[]): string {
    const list = rows.filter((r) => r.value !== "")
    if (!list.length) return ""
    const t = EMAIL_THEME
    const body = list
        .map(
            (r) => `<tr>
        <td valign="top" width="40%" class="dim" style="padding:7px 12px 7px 0;${textStyle({ size: 13, lh: 1.5, weight: 500, color: t.dim })}">${esc(r.label)}</td>
        <td valign="top" class="ink" style="padding:7px 0;${textStyle({ size: 13, lh: 1.5, weight: 500, color: t.ink })}word-break:break-word;overflow-wrap:break-word;">${esc(r.value)}</td>
      </tr>`,
        )
        .join("")
    return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${T_RESET}">${body}</table>`, 16)
}

/** Review findings — the block that carries the actual substance of a PR review
 *  mail. A left tone bar per item (a coloured table cell, not a border-left, so
 *  it survives Word), so severity reads before the words do. */
export function findingList(
    items: { tone: EmailTone; label: string; title: string; detail?: string | null; location?: string | null }[],
): string {
    if (!items.length) return ""
    const t = EMAIL_THEME
    const body = items
        .map((f) => {
            const tone = TONE[f.tone]
            return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${T_RESET_SEP}margin-bottom:10px;">
          <tr>
            <td width="3" bgcolor="${tone.solid}" style="width:3px;background:${tone.solid};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>
            <td class="panel" bgcolor="${t.surfaceAlt}" style="background:${t.surfaceAlt};border:1px solid ${t.border};border-left:0;border-radius:0 12px 12px 0;padding:14px 16px;">
              <div style="${textStyle({ size: 11, lh: 1, weight: 700, color: tone.fg, track: ".09em", upper: true })}">${esc(f.label)}</div>
              <div class="panel-ink" style="margin-top:7px;${textStyle({ size: 15, lh: 1.45, weight: 600, color: t.ink })}">${esc(f.title)}</div>
              ${f.location ? `<div class="dim" style="margin-top:5px;${textStyle({ size: 12, lh: 1.5, color: t.dim, family: t.mono })}word-break:break-all;overflow-wrap:anywhere;">${esc(f.location)}</div>` : ""}
              ${f.detail ? `<div class="muted" style="margin-top:8px;${textStyle({ size: 14, lh: 1.6, color: t.muted })}">${esc(f.detail)}</div>` : ""}
            </td>
          </tr>
        </table>`
        })
        .join("")
    return row(body, 14)
}

// ─── internals ───────────────────────────────────────────────────────────────

/** Wrap block markup in the shell's content column. */
function row(inner: string, top: number): string {
    return `<tr><td class="px" style="padding:${top}px 36px 0 36px;">${inner}</td></tr>`
}

// The padding lives on a table CELL, with the colour as a bgcolor attribute, and
// the anchor only carries type + colour. Word ignores padding on an inline <a>,
// so the common "padded anchor" button collapses there to bare underlined text;
// this shape is solid everywhere. The rounded corner is the only casualty in
// Outlook, which squares it off.
function button(action: EmailAction): string {
    const t = EMAIL_THEME
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${T_RESET_SEP}"><tr>
      <td align="center" bgcolor="${t.ember}" style="background:${t.ember};border-radius:11px;padding:13px 26px;">
        <a href="${esc(action.url)}" style="${textStyle({ size: 15, lh: 1, weight: 600, color: "#ffffff" })}text-decoration:none;display:inline-block;">${esc(action.label)}</a>
      </td></tr></table>`
}

/** Absolute in-app URL for a mail link.
 *
 *  NEXT_PUBLIC_APP_URL is required for this to resolve: mail is sent from
 *  DB-driven callbacks and background paths that have no request origin to
 *  borrow. Unset, it returns "" — and every caller treats an empty URL as "no
 *  link", rather than emitting a relative href a mail client can't follow. */
export function appUrl(path = ""): string {
    const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/+$/, "")
    if (!base) return ""
    if (!path) return base
    return `${base}${path.startsWith("/") ? "" : "/"}${path}`
}

/** Escape a string for HTML text/attribute context. Every caller-supplied
 *  string in this module goes through it — the inputs are repo names, PR
 *  titles and model-written review prose. */
export function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
}

/** Build the plain-text alternative: drop nulls, collapse runs of blank lines.
 *  Every template ships one — a text/plain part is what keeps a mail out of the
 *  spam bucket, and what a watch or a screen reader actually reads out. */
export function plainText(lines: (string | null | undefined | false)[]): string {
    return lines
        .filter((l): l is string => typeof l === "string")
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

/** Shorten model-written prose to a mail-sized excerpt, on a word boundary. */
export function excerpt(s: string, max: number): string {
    const clean = s.replace(/\s+/g, " ").trim()
    if (clean.length <= max) return clean
    const cut = clean.slice(0, max)
    const at = cut.lastIndexOf(" ")
    return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[.,;:—-]+$/, "")}…`
}

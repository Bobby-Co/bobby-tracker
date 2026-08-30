import type { DragEvent } from "react"
import { issueRefMarkdown } from "@/modules/issues/domain/IssueRef"

// The clipboard for dragging an issue into a composer.
//
// A private MIME carries the structured payload (so only our own drop targets
// react), and text/plain carries the finished markdown reference — so an issue
// dropped into ANY plain textarea still lands as a usable link rather than as
// nothing. getData for the private type is readable only on `drop` (the drag
// spec hides data during `dragover`), so acceptance checks read `.types`.

export const ISSUE_DND_MIME = "application/x-bobby-issue-ref"

export interface IssueDragPayload {
    projectId: string
    issueId: string
    number: number
    title: string
}

export function setIssueDragData(e: DragEvent, p: IssueDragPayload): void {
    try {
        e.dataTransfer.setData(ISSUE_DND_MIME, JSON.stringify(p))
        e.dataTransfer.setData("text/plain", issueRefMarkdown(p.projectId, p.issueId, p.number, p.title))
        // "copy" — the cursor gains a + badge, signalling the issue is being
        // referenced, not moved: the row stays put.
        e.dataTransfer.effectAllowed = "copy"

        // A tailored drag image: a small tilted card carrying the issue's
        // identity, so what follows the cursor reads as "this issue" rather than
        // a ghost of a full-width row. Built off-screen, snapshotted by the
        // browser at setDragImage time, then removed.
        const ghost = makeDragGhost(p.number, p.title)
        document.body.appendChild(ghost)
        e.dataTransfer.setDragImage(ghost, 24, 20)
        setTimeout(() => ghost.remove(), 0)

        // Gently lift the source while it's in flight — still visible (it isn't
        // going anywhere), just clearly the one being carried. Restored on drop.
        const el = e.currentTarget as HTMLElement | null
        if (el) {
            el.style.opacity = "0.55"
            const restore = () => {
                el.style.opacity = ""
                el.removeEventListener("dragend", restore)
            }
            el.addEventListener("dragend", restore)
        }
    } catch {
        /* some browsers restrict setData outside dragstart — ignore */
    }
}

/** The off-screen element the browser snapshots for the drag cursor. Inline
 *  styles (not utility classes) so it renders identically no matter which
 *  classes happened to be compiled, and CSS variables so it tracks the theme. */
function makeDragGhost(number: number, title: string): HTMLElement {
    const g = document.createElement("div")
    Object.assign(g.style, {
        position: "absolute",
        top: "-1000px",
        left: "-1000px",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        maxWidth: "300px",
        padding: "7px 11px",
        borderRadius: "10px",
        border: "1px solid var(--c-border-strong)",
        background: "var(--c-surface)",
        boxShadow: "var(--shadow-pop)",
        color: "var(--c-text)",
        font: "600 12.5px ui-sans-serif, system-ui, -apple-system, sans-serif",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        transform: "rotate(-2deg)",
        pointerEvents: "none",
        zIndex: "2147483647",
    })
    g.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="flex:none;color:var(--c-text-dim)">' +
        '<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4"/>' +
        '<circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>'
    const num = document.createElement("span")
    num.textContent = `#${number}`
    num.style.color = "var(--c-text-dim)"
    num.style.fontVariantNumeric = "tabular-nums"
    const label = document.createElement("span")
    label.textContent = title
    label.style.overflow = "hidden"
    label.style.textOverflow = "ellipsis"
    g.appendChild(num)
    g.appendChild(label)
    return g
}

/** Whether a drag in flight is one of ours — safe to call during `dragover`. */
export function isIssueDrag(e: DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes(ISSUE_DND_MIME)
}

/** The payload behind a drop, or null when it isn't our drag. */
export function readIssueDragData(e: DragEvent): IssueDragPayload | null {
    const raw = e.dataTransfer.getData(ISSUE_DND_MIME)
    if (!raw) return null
    try {
        const p = JSON.parse(raw) as Partial<IssueDragPayload>
        if (typeof p?.projectId === "string" && typeof p.issueId === "string" && typeof p.number === "number") {
            return { projectId: p.projectId, issueId: p.issueId, number: p.number, title: String(p.title ?? "") }
        }
    } catch {
        /* not our payload */
    }
    return null
}

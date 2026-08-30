// The transforms behind the tools strip — bold, italic, code, heading, quote,
// list, link.
//
// Each one takes an editor SELECTION (the text and the two offsets a textarea
// reports) and returns the new selection. They are pure and they are toggles:
// pressing Bold on already-bold text un-bolds it, so the strip button and a
// keyboard shortcut behave the way every editor has trained people to expect,
// and the caret lands somewhere sensible so typing can continue without a
// mouse. Kept out of the React component and tested directly, because "the
// caret ended up one character off" is exactly the kind of bug a screenshot
// hides.

import { lineAt } from "./MarkdownBlocks"

export interface Selection {
    text: string
    /** Selection anchor (inclusive). */
    start: number
    /** Selection head (exclusive). */
    end: number
}

/** Wrap the selection in `token`, or unwrap it if it is already wrapped.
 *
 *  With no selection, inserts the empty pair and puts the caret between the two
 *  halves — so clicking Bold and typing produces bold text. */
export function toggleInline(sel: Selection, token: string): Selection {
    const { text } = sel
    const start = clamp(sel.start, text.length)
    const end = clamp(Math.max(sel.end, sel.start), text.length)
    const inner = text.slice(start, end)

    // Already wrapped, selection inside the markers: strip them.
    if (
        text.slice(start - token.length, start) === token &&
        text.slice(end, end + token.length) === token
    ) {
        const next = text.slice(0, start - token.length) + inner + text.slice(end + token.length)
        return { text: next, start: start - token.length, end: end - token.length }
    }
    // Already wrapped, markers inside the selection: strip them.
    if (inner.startsWith(token) && inner.endsWith(token) && inner.length >= token.length * 2) {
        const stripped = inner.slice(token.length, inner.length - token.length)
        const next = text.slice(0, start) + stripped + text.slice(end)
        return { text: next, start, end: start + stripped.length }
    }

    const next = text.slice(0, start) + token + inner + token + text.slice(end)
    if (start === end) {
        // Empty: caret between the markers.
        const caret = start + token.length
        return { text: next, start: caret, end: caret }
    }
    return { text: next, start: start + token.length, end: end + token.length }
}

export const bold = (s: Selection) => toggleInline(s, "**")
export const italic = (s: Selection) => toggleInline(s, "*")
export const inlineCode = (s: Selection) => toggleInline(s, "`")

/** Cycle the heading level of the caret's line: none → # → ## → ### → none. */
export function cycleHeading(sel: Selection): Selection {
    const { start, line } = lineAt(sel.text, sel.start)
    const m = /^(#{1,6})\s+/.exec(line)
    const level = m ? m[1].length : 0
    const stripped = m ? line.slice(m[0].length) : line
    // 0 → "# ", 1 → "## ", 2 → "### ", then back to plain text.
    const rebuilt = level === 0 ? `# ${stripped}` : level >= 3 ? stripped : `${"#".repeat(level + 1)} ${stripped}`
    return replaceLine(sel, start, line, rebuilt, rebuilt.length - line.length)
}

/** Toggle a line prefix (`> `, `- `) on every line the selection touches. */
export function toggleLinePrefix(sel: Selection, prefix: string): Selection {
    const startInfo = lineAt(sel.text, sel.start)
    const endInfo = lineAt(sel.text, Math.max(sel.end, sel.start))
    const blockStart = startInfo.start
    const blockEnd = endInfo.end
    const segment = sel.text.slice(blockStart, blockEnd)
    const lines = segment.split("\n")
    const allPrefixed = lines.every((l) => l.startsWith(prefix) || l.trim() === "")
    const next = lines
        .map((l) => {
            if (l.trim() === "") return l
            return allPrefixed ? l.slice(prefix.length) : prefix + l
        })
        .join("\n")
    const delta = next.length - segment.length
    const text = sel.text.slice(0, blockStart) + next + sel.text.slice(blockEnd)
    return { text, start: blockStart, end: blockEnd + delta }
}

export const toggleQuote = (s: Selection) => toggleLinePrefix(s, "> ")
export const toggleBulletList = (s: Selection) => toggleLinePrefix(s, "- ")

/** Wrap the selection as a link. Caret lands in the URL slot (or, with no
 *  selection, in the text slot) so the next keystroke goes where it is needed. */
export function insertLink(sel: Selection): Selection {
    const { text } = sel
    const start = clamp(sel.start, text.length)
    const end = clamp(Math.max(sel.end, sel.start), text.length)
    const label = text.slice(start, end)
    if (label) {
        const next = `${text.slice(0, start)}[${label}](url)${text.slice(end)}`
        const urlStart = start + label.length + 3 // [label](
        return { text: next, start: urlStart, end: urlStart + 3 }
    }
    const next = `${text.slice(0, start)}[](url)${text.slice(end)}`
    const caret = start + 1 // inside the []
    return { text: next, start: caret, end: caret }
}

/** Insert raw text at the caret, replacing any selection. */
export function insertAtCaret(sel: Selection, str: string): Selection {
    const start = clamp(sel.start, sel.text.length)
    const end = clamp(Math.max(sel.end, sel.start), sel.text.length)
    const next = sel.text.slice(0, start) + str + sel.text.slice(end)
    const caret = start + str.length
    return { text: next, start: caret, end: caret }
}

function replaceLine(sel: Selection, lineStart: number, oldLine: string, newLine: string, caretDelta: number): Selection {
    const text = sel.text.slice(0, lineStart) + newLine + sel.text.slice(lineStart + oldLine.length)
    const start = clamp(sel.start + caretDelta, text.length)
    return { text, start, end: start }
}

function clamp(n: number, max: number): number {
    return Math.max(0, Math.min(Number.isFinite(n) ? n : max, max))
}

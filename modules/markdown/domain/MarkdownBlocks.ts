// Splitting a markdown document into editable BLOCKS, and the caret rules an
// Obsidian-style live editor needs to move between them.
//
// The live editor renders every finished block as markdown and keeps only the
// block the cursor is in as raw source. "Finished block" has to mean the same
// thing here as it does to the renderer, or a block that looks like a heading
// while you edit it would render as part of the paragraph below once you leave.
// So the split rule is markdown's own: a blank line ends a block — EXCEPT inside
// a fenced code block, whose blank lines are content and must not split it.
//
// Everything here is pure and string-in/string-out on purpose: the block model
// is the one part of the editor that is invisible until it is subtly wrong (a
// caret that jumps, a list that won't continue), so it is tested rather than
// eyeballed in a screenshot — the same reasoning as EmbedInsertion next door.

/** A fence opener/closer: three-or-more backticks or tildes, maybe indented. */
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})/

/** Split `doc` into block strings, in order.
 *
 *  Blocks are separated by one or more blank lines; a fenced code block counts
 *  as one block even when it contains blank lines. Blank runs and trailing
 *  whitespace-only lines are dropped — they carry no content and reappear as
 *  the `\n\n` join, so keeping them would make the model drift on every
 *  round-trip. */
export function splitBlocks(doc: string): string[] {
    const lines = doc.replace(/\r\n?/g, "\n").split("\n")
    const blocks: string[] = []
    let cur: string[] = []
    let fenceChar: string | null = null
    let fenceLen = 0

    const flush = () => {
        if (cur.length > 0) {
            blocks.push(cur.join("\n"))
            cur = []
        }
    }

    for (const line of lines) {
        if (fenceChar) {
            cur.push(line)
            const t = line.trim()
            // A line of the same fence character, at least as long as the
            // opener and nothing else, closes the fence.
            if (t.length >= fenceLen && t === fenceChar.repeat(t.length) && t[0] === fenceChar) {
                fenceChar = null
                flush()
            }
            continue
        }

        const open = FENCE_OPEN.exec(line)
        if (open) {
            // A fence starts its own block, whatever preceded it on the page.
            flush()
            fenceChar = open[2][0]
            fenceLen = open[2].length
            cur.push(line)
            continue
        }

        if (line.trim() === "") {
            flush()
            continue
        }
        cur.push(line)
    }
    flush()
    return blocks
}

/** Reassemble block strings into a document. This is what the editor emits, so
 *  it is deliberately normalising: trailing whitespace is trimmed, empty blocks
 *  are dropped (a blank block is not content), and blocks are separated by a
 *  single blank line. */
export function joinBlocks(blocks: string[]): string {
    return blocks
        .map((b) => b.replace(/[ \t]+$/gm, "").replace(/\n+$/, ""))
        .filter((b) => b.trim() !== "")
        .join("\n\n")
}

/** The bounds and text of the line `caret` sits on, within `text`. */
export function lineAt(text: string, caret: number): { start: number; end: number; line: string } {
    const c = clamp(caret, text.length)
    const start = text.lastIndexOf("\n", c - 1) + 1
    const nl = text.indexOf("\n", c)
    const end = nl === -1 ? text.length : nl
    return { start, end, line: text.slice(start, end) }
}

/** Whether `caret` is inside an unterminated code fence within this block.
 *
 *  A block is edited in isolation, so we only look at fences opened before the
 *  caret and not yet closed: an odd number of fence lines above means the caret
 *  is inside code, where Enter must add a newline rather than split the block. */
export function caretInFence(text: string, caret: number): boolean {
    const before = text.slice(0, clamp(caret, text.length))
    let open = false
    for (const line of before.split("\n")) {
        if (FENCE_OPEN.test(line)) open = !open
    }
    return open
}

export interface ListItem {
    /** Leading whitespace, preserved so a continuation lines up. */
    indent: string
    /** True for `1.` / `1)` style, false for `-` `*` `+`. */
    ordered: boolean
    /** The bullet char, or the parsed number for ordered lists. */
    bullet: string
    number: number
    /** The delimiter after an ordered number: `.` or `)`. */
    delimiter: string
    /** True when the item has a marker but no text after it. */
    empty: boolean
}

const UNORDERED = /^(\s*)([-*+])\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})([.)])\s+(.*)$/

/** Parse `line` as a list item, or return null. */
export function listItem(line: string): ListItem | null {
    const u = UNORDERED.exec(line)
    if (u) {
        return { indent: u[1], ordered: false, bullet: u[2], number: 0, delimiter: "", empty: u[3].trim() === "" }
    }
    const o = ORDERED.exec(line)
    if (o) {
        return {
            indent: o[1],
            ordered: true,
            bullet: o[2],
            number: Number(o[2]),
            delimiter: o[3],
            empty: o[4].trim() === "",
        }
    }
    return null
}

/** The marker that continues `item` on the next line (numbers increment). */
export function nextListPrefix(item: ListItem): string {
    if (item.ordered) return `${item.indent}${item.number + 1}${item.delimiter} `
    return `${item.indent}${item.bullet} `
}

function clamp(n: number, max: number): number {
    return Math.max(0, Math.min(Number.isFinite(n) ? n : max, max))
}

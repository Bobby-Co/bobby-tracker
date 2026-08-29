// Writing a reference into a body at the caret.
//
// Pure, and separate from the editor, for one reason: markdown's block rules
// are the whole difficulty here and they are invisible in a screenshot until
// they are wrong. An image dropped straight after a line of prose joins that
// paragraph and renders INLINE, mid-sentence, at the component's natural size.
// Getting the blank lines right is the difference between an embed and a
// wrecked paragraph, so it is a function with tests rather than an expression
// inside an onClick.

import { embedRef } from "./EmbedRef"

export interface EmbedInsertion {
    /** The new body text. */
    text: string
    /** Where to put the caret afterwards — just past the reference. */
    caret: number
}

/** The markdown for an embed, with alt text.
 *
 *  The alt is not optional and not cosmetic: the render carries no text layer,
 *  so this string is the entire accessible content of the image (contract §8).
 *  Zoo's componentId is the best automatic guess; an author can improve it. */
export function embedMarkdown(embedId: string, alt: string): string {
    // ] and ) would terminate the alt / target early and break the reference.
    const safeAlt = alt.replace(/[[\]]/g, "").trim() || "Component preview"
    return `![${safeAlt}](${embedRef(embedId)})`
}

/** Insert a reference as its own block, replacing any selection. */
export function insertEmbedReference(
    body: string,
    selectionStart: number,
    selectionEnd: number,
    embedId: string,
    alt: string,
): EmbedInsertion {
    const start = clamp(selectionStart, body.length)
    const end = clamp(Math.max(selectionEnd, selectionStart), body.length)
    const before = body.slice(0, start)
    const after = body.slice(end)
    const reference = embedMarkdown(embedId, alt)

    // Pad up to a blank line on each side, but never add padding that is
    // already there — inserting repeatedly must not walk the body downwards or
    // accumulate blank lines at the end of it.
    const lead = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
    const head = before + lead + reference

    // Nothing but whitespace follows: the reference ends the body and needs one
    // closing newline, not a blank line after it.
    const tail =
        after.trim() === ""
            ? after || "\n"
            : after.startsWith("\n\n")
              ? after
              : after.startsWith("\n")
                ? `\n${after}`
                : `\n\n${after}`

    return { text: head + tail, caret: head.length }
}

function clamp(n: number, max: number): number {
    return Math.max(0, Math.min(Number.isFinite(n) ? n : max, max))
}

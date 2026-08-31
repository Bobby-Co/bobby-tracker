"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/components/ui/cn"
import { MarkdownBody } from "@/components/markdown/markdown-body"
import { EmbedPicker } from "@/components/embeds/embed-picker"
import { embedMarkdown } from "@/modules/embeds/domain/EmbedInsertion"
import { issueRefMarkdown } from "@/modules/issues/domain/IssueRef"
import { isIssueDrag, readIssueDragData, type IssueDragPayload } from "@/components/issues/issue-drag"
import type { SignedEmbed, SignedEmbedMap } from "@/modules/embeds/domain/SignedEmbed"
import {
    splitBlocks,
    joinBlocks,
    lineAt,
    caretInFence,
    listItem,
    nextListPrefix,
} from "@/modules/markdown/domain/MarkdownBlocks"
import {
    bold,
    italic,
    inlineCode,
    cycleHeading,
    toggleQuote,
    toggleBulletList,
    insertLink,
    type Selection,
} from "@/modules/markdown/domain/MarkdownFormatting"

// An Obsidian-style live markdown editor.
//
// The document is a single string (that is what every caller persists and what
// the analyser reads), but it is EDITED as a stack of blocks: every finished
// block renders as markdown — headings, lists, and Zoo embeds included — and
// only the block the cursor is in shows raw source. Press Enter and the block
// you just left renders while a fresh one opens beneath it; click a rendered
// block to drop back into its source. The block model and its caret rules live
// in modules/markdown/domain, tested, because they are invisible until subtly
// wrong.
//
// The tools strip (top bar and right-click menu) formats the active block's
// selection; "Add component" is the existing Zoo picker, and an inserted embed
// arrives as its own rendered block. A Source toggle drops the whole thing to
// one plain textarea — an escape hatch for anyone who would rather see the
// markup, and a safety net if the block model ever meets input it mishandles.

interface Block {
    id: string
    text: string
}

// Block ids only need to be unique per render tree and stable across renders;
// a process-wide counter gives that without a ref read during render (which the
// initializer would otherwise do). React keys never leave the client.
let BLOCK_SEQ = 0
const nid = () => `b${BLOCK_SEQ++}`

export function MarkdownEditor({
    value,
    onChange,
    projectId,
    embeds,
    onEmbedInserted,
    placeholder = "Write in markdown… press Enter to render a block.",
    minHeight = 160,
    ariaLabel = "Markdown editor",
    thinking = false,
    morphSignal = 0,
}: {
    value: string
    onChange: (value: string) => void
    /** Enables the "Add component" (Zoo) button. Omit where there is no project
     *  context (embeds can't be signed without one). */
    projectId?: string
    /** Embeds already signed for this body by the server. Merged under embeds
     *  inserted in this session so the live preview resolves both. */
    embeds?: SignedEmbedMap
    /** Lifts a freshly minted embed to the owner — the detail view keeps these
     *  so the saved body renders before the server re-signs. */
    onEmbedInserted?: (embed: SignedEmbed) => void
    placeholder?: string
    minHeight?: number
    ariaLabel?: string
    /** Something is writing into this editor right now — drives the scan band.
     *  The document is what is being worked on, so the document is what looks
     *  busy; a spinner elsewhere would point at the wrong thing. */
    thinking?: boolean
    /** Bump to replay the arrival animation. A NUMBER rather than a boolean
     *  because two consecutive rewrites are two events, and a flag that is
     *  already true cannot express the second one. The owner bumps it; this
     *  never infers a rewrite from `value` changing, or every keystroke echoed
     *  back through the prop would re-animate the document. */
    morphSignal?: number
}) {
    const [blocks, setBlocks] = useState<Block[]>(() =>
        splitBlocks(value).map((text) => ({ id: nid(), text })),
    )
    const [activeId, setActiveId] = useState<string | null>(null)
    const [sourceMode, setSourceMode] = useState(false)
    const [inserted, setInserted] = useState<SignedEmbedMap>({})
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
    // True while an issue is being dragged over the editor — drives the drop ring.
    const [issueDropActive, setIssueDropActive] = useState(false)

    // The last document we emitted. Lets us tell OUR change (echoed back through
    // the value prop) from a genuine external reset, so we only rebuild blocks
    // for the latter — rebuilding on every keystroke would strip the caret.
    const lastEmitted = useRef(value)
    const activeRef = useRef<HTMLTextAreaElement | null>(null)
    const lastActiveId = useRef<string | null>(null)
    const pendingCaret = useRef<number | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const embedWrapRef = useRef<HTMLDivElement>(null)
    // True while a split/merge/insert is swapping which block is a textarea. The
    // outgoing textarea unmounts mid-focus and fires a blur with no relatedTarget
    // — indistinguishable from a click away unless we mark the reflow, which
    // would otherwise cancel the very block we just opened.
    const reflowing = useRef(false)

    const mergedEmbeds: SignedEmbedMap = { ...inserted, ...(embeds ?? {}) }

    useEffect(() => {
        if (value === lastEmitted.current) return
        // External reset (e.g. the form cleared, or a different issue loaded).
        lastEmitted.current = value
        setBlocks(splitBlocks(value).map((text) => ({ id: nid(), text })))
        setActiveId(null)
    }, [value])

    const emit = useCallback(
        (next: Block[]) => {
            const doc = joinBlocks(next.map((b) => b.text))
            lastEmitted.current = doc
            onChange(doc)
        },
        [onChange],
    )

    const commit = useCallback(
        (next: Block[]) => {
            setBlocks(next)
            emit(next)
        },
        [emit],
    )

    // Focus the active block and restore its caret after a structural change.
    useEffect(() => {
        reflowing.current = false
        if (sourceMode) return
        if (!activeId) return
        lastActiveId.current = activeId
        const el = activeRef.current
        if (!el) return
        el.focus()
        autosize(el)
        if (pendingCaret.current != null) {
            const c = Math.min(pendingCaret.current, el.value.length)
            el.setSelectionRange(c, c)
            pendingCaret.current = null
        }
    }, [activeId, sourceMode])

    const setActiveText = useCallback(
        (id: string, text: string) => {
            commit(blocks.map((b) => (b.id === id ? { ...b, text } : b)))
        },
        [blocks, commit],
    )

    const activate = useCallback((id: string, caret?: number) => {
        pendingCaret.current = caret ?? null
        setActiveId(id)
    }, [])

    /** Replace one block with two — the split that Enter performs. */
    const splitInto = useCallback(
        (id: string, firstText: string, secondText: string) => {
            const next: Block[] = []
            let newId: string | null = null
            for (const b of blocks) {
                if (b.id === id) {
                    const second = { id: nid(), text: secondText }
                    newId = second.id
                    next.push({ id, text: firstText }, second)
                } else next.push(b)
            }
            reflowing.current = true
            commit(next)
            if (newId) {
                pendingCaret.current = 0
                setActiveId(newId)
            }
        },
        [blocks, commit],
    )

    const mergeIntoPrevious = useCallback(
        (id: string) => {
            const idx = blocks.findIndex((b) => b.id === id)
            if (idx <= 0) return
            const prev = blocks[idx - 1]
            const caret = prev.text.length
            const merged = prev.text + blocks[idx].text
            const next = blocks
                .filter((_, i) => i !== idx)
                .map((b) => (b.id === prev.id ? { ...b, text: merged } : b))
            reflowing.current = true
            commit(next)
            pendingCaret.current = caret
            setActiveId(prev.id)
        },
        [blocks, commit],
    )

    function onBlockKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, block: Block) {
        const el = e.currentTarget
        const s = el.selectionStart
        const en = el.selectionEnd
        const text = el.value

        // Shortcuts.
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
            const k = e.key.toLowerCase()
            if (k === "b") return void (e.preventDefault(), applyFormat(bold))
            if (k === "i") return void (e.preventDefault(), applyFormat(italic))
            if (k === "k") return void (e.preventDefault(), applyFormat(insertLink))
        }

        if (e.key === "Escape") {
            e.preventDefault()
            // Escape exits block-edit only — don't let it reach a host that treats
            // Escape as "close" (the composer panel listens on `document`), or one
            // keypress would both leave the block and shut the whole surface.
            // React's stopPropagation won't stop that document listener;
            // stopImmediatePropagation on the native event does.
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
            deactivate()
            return
        }

        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            if (caretInFence(text, s)) return // inside a code fence: newline is content
            const { start: lineStart, line } = lineAt(text, s)
            const item = s === en ? listItem(line) : null
            if (item && !item.empty) {
                // Continue the list on a new line, same block.
                e.preventDefault()
                const ins = "\n" + nextListPrefix(item)
                const next = text.slice(0, s) + ins + text.slice(en)
                setActiveText(block.id, next)
                queueCaret(el, s + ins.length)
                return
            }
            if (item && item.empty) {
                // Empty item: drop the marker and end the list — split here.
                e.preventDefault()
                splitInto(block.id, text.slice(0, lineStart).replace(/\n+$/, ""), text.slice(en))
                return
            }
            // Plain block: commit what's above the caret, carry the rest down.
            e.preventDefault()
            splitInto(block.id, text.slice(0, s), text.slice(en))
            return
        }

        if (e.key === "Backspace" && s === 0 && en === 0) {
            const idx = blocks.findIndex((b) => b.id === block.id)
            if (idx > 0) {
                e.preventDefault()
                mergeIntoPrevious(block.id)
            }
            return
        }

        if (e.key === "ArrowUp" && s === en && lineAt(text, s).start === 0) {
            const idx = blocks.findIndex((b) => b.id === block.id)
            if (idx > 0) {
                e.preventDefault()
                activate(blocks[idx - 1].id, blocks[idx - 1].text.length)
            }
            return
        }
        if (e.key === "ArrowDown" && s === en && lineAt(text, s).end === text.length) {
            const idx = blocks.findIndex((b) => b.id === block.id)
            if (idx < blocks.length - 1) {
                e.preventDefault()
                activate(blocks[idx + 1].id, 0)
            }
        }
    }

    /** The blocks a browser text selection actually touches.
     *
     *  Dragging across rendered blocks makes ONE Range spanning several sibling
     *  elements; there is no textarea involved and so, before this, no keystroke
     *  could act on it — Backspace over five selected paragraphs did nothing at
     *  all, which reads as a broken editor rather than as an unimplemented one.
     *
     *  intersectsNode rather than comparing offsets: a Range that merely clips
     *  the first and last blocks still means "these blocks are selected", and
     *  the alternative is reimplementing that arithmetic for every node type
     *  MarkdownBody can render. */
    const selectedBlockIds = useCallback((): string[] => {
        const sel = typeof window !== "undefined" ? window.getSelection() : null
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return []
        const range = sel.getRangeAt(0)
        const host = containerRef.current
        if (!host) return []
        return blocks
            .filter((b) => {
                const el = host.querySelector(`[data-block-id="${b.id}"]`)
                return !!el && range.intersectsNode(el)
            })
            .map((b) => b.id)
    }, [blocks])

    /** Backspace/Delete over a multi-block selection removes those blocks.
     *
     *  Bound on the CONTAINER, not on a block: the whole point is that no block
     *  owns this selection. It deliberately does nothing when the selection
     *  touches one block or none — a caret inside the active textarea reports no
     *  selection here, so ordinary typing and single-block editing keep their
     *  native behaviour untouched. */
    function onContainerKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        if (e.key !== "Backspace" && e.key !== "Delete") return
        const ids = selectedBlockIds()
        if (ids.length === 0) return
        // One block, and it is the one being edited: that is a normal in-textarea
        // selection, and the textarea deletes it far better than we would.
        if (ids.length === 1 && ids[0] === activeId) return

        e.preventDefault()
        const doomed = new Set(ids)
        const next = blocks.filter((b) => !doomed.has(b.id))
        window.getSelection()?.removeAllRanges()
        reflowing.current = true
        // Deleting everything leaves the empty-state button rather than a
        // zero-height editor with nothing to click.
        commit(next)
        setActiveId(next.some((b) => b.id === activeId) ? activeId : null)
    }

    /** Drop the active block, prune empties, and render everything. */
    const deactivate = useCallback(() => {
        setActiveId(null)
        setBlocks((prev) => {
            const pruned = prev.filter((b) => b.text.trim() !== "")
            return pruned.length === prev.length ? prev : pruned
        })
    }, [])

    const startFirstBlock = useCallback(() => {
        const b = { id: nid(), text: "" }
        reflowing.current = true
        commit([b])
        pendingCaret.current = 0
        setActiveId(b.id)
    }, [commit])

    /** Apply a formatting transform to the active block's selection. Read only
     *  at click time — a useCallback so the ref reads live in an event handler,
     *  not in the render that builds the tools strip. */
    const applyFormat = useCallback(
        (fn: (s: Selection) => Selection) => {
            const el = activeRef.current
            const id = activeId ?? lastActiveId.current
            if (!el || !id) {
                // Nothing is being edited — open the last block so the next click lands.
                if (blocks.length > 0) activate(blocks[blocks.length - 1].id, blocks[blocks.length - 1].text.length)
                else startFirstBlock()
                return
            }
            const result = fn({ text: el.value, start: el.selectionStart, end: el.selectionEnd })
            setActiveText(id, result.text)
            queueCaret(el, result.start, result.end)
        },
        [activeId, blocks, activate, setActiveText, startFirstBlock],
    )

    function insertEmbed(embed: SignedEmbed) {
        const md = embedMarkdown(embed.embedId, embed.componentId ?? "Component preview")
        const anchor = activeId ?? lastActiveId.current
        const idx = anchor ? blocks.findIndex((b) => b.id === anchor) : blocks.length - 1
        const image = { id: nid(), text: md }
        const trailing = { id: nid(), text: "" }
        const at = idx < 0 ? blocks.length : idx + 1
        const next = [...blocks.slice(0, at), image, trailing, ...blocks.slice(at)]
        reflowing.current = true
        commit(next)
        setInserted((m) => ({ ...m, [embed.embedId]: embed }))
        onEmbedInserted?.(embed)
        pendingCaret.current = 0
        setActiveId(trailing.id)
    }

    /** Drop an issue reference in. Unlike an embed (its own block), a reference
     *  reads inline — "blocked by #42" — so it goes at the caret of the block
     *  being edited, or into a fresh block when nothing is active. */
    function insertIssueRef(p: IssueDragPayload) {
        const md = issueRefMarkdown(p.projectId, p.issueId, p.number, p.title)
        const el = activeRef.current
        const id = activeId ?? lastActiveId.current
        if (el && id) {
            const s = el.selectionStart
            const en = el.selectionEnd
            const text = el.value
            const before = text.slice(0, s)
            const after = text.slice(en)
            const lead = before && !/\s$/.test(before) ? " " : ""
            const trail = after && !/^\s/.test(after) ? " " : ""
            const insert = lead + md + trail
            setActiveText(id, before + insert + after)
            queueCaret(el, s + insert.length)
        } else {
            reflowing.current = true
            const b = { id: nid(), text: md }
            commit([...blocks, b])
            pendingCaret.current = md.length
            setActiveId(b.id)
        }
    }

    function openPickerFromMenu() {
        setMenu(null)
        embedWrapRef.current?.querySelector<HTMLButtonElement>("button")?.click()
    }

    function onContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
        if (reflowing.current) return // a block is being swapped, not left
        const next = e.relatedTarget as Node | null
        if (next && containerRef.current?.contains(next)) return
        if (menu) return // keep editing while the right-click strip is open
        deactivate()
    }

    // ---- rendering ---------------------------------------------------------

    return (
        <div
            ref={containerRef}
            onBlur={onContainerBlur}
            onDragOver={(e) => {
                if (!isIssueDrag(e)) return
                // Accept the drop and keep the browser from navigating/opening it.
                e.preventDefault()
                e.dataTransfer.dropEffect = "copy"
                if (!issueDropActive) setIssueDropActive(true)
            }}
            onDragLeave={(e) => {
                // Only clear when the pointer actually left the editor, not when it
                // crossed between child blocks.
                if (!containerRef.current?.contains(e.relatedTarget as Node | null)) setIssueDropActive(false)
            }}
            onDrop={(e) => {
                const payload = readIssueDragData(e)
                if (!payload) return
                e.preventDefault()
                setIssueDropActive(false)
                insertIssueRef(payload)
            }}
            className={cn(
                "rounded-[12px] border bg-[color:var(--c-surface)] transition-colors",
                issueDropActive
                    ? "border-[color:var(--c-primary)] ring-2 ring-[color:var(--c-ring)]"
                    : "border-[color:var(--c-border)] focus-within:border-[color:var(--c-border-strong)]",
            )}
        >
            <div className="flex flex-wrap items-center gap-0.5 border-b border-[color:var(--c-border)] px-1.5 py-1">
                {TOOLS.map((t) => (
                    <ToolButton key={t.key} label={t.label} glyph={t.glyph} onRun={() => applyFormat(t.format)} />
                ))}
                {projectId ? (
                    <>
                        <Divider />
                        <div ref={embedWrapRef} className="flex items-center">
                            <EmbedPicker projectId={projectId} onInsert={insertEmbed} />
                        </div>
                    </>
                ) : null}
                <div className="ml-auto">
                    <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                            if (sourceMode) {
                                setBlocks(splitBlocks(value).map((text) => ({ id: nid(), text })))
                            } else {
                                deactivate()
                            }
                            setSourceMode((v) => !v)
                        }}
                        aria-pressed={sourceMode}
                        title={sourceMode ? "Back to live preview" : "Edit raw markdown"}
                        className={cn(
                            "rounded-md px-2 py-1 text-[11px] font-semibold text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]",
                            sourceMode && "bg-[color:var(--c-overlay)] text-[color:var(--c-text)]",
                        )}
                    >
                        {sourceMode ? "Live" : "Source"}
                    </button>
                </div>
            </div>

            {sourceMode ? (
                <textarea
                    value={value}
                    onChange={(e) => {
                        lastEmitted.current = e.target.value
                        onChange(e.target.value)
                    }}
                    placeholder={placeholder}
                    aria-label={ariaLabel}
                    style={{ minHeight }}
                    className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[12.5px] leading-6 text-[color:var(--c-text)] outline-none placeholder:text-[color:var(--c-text-dim)]"
                />
            ) : (
                <div
                    // `key` on the morph signal so the animation RESTARTS: CSS
                    // animations do not replay on an element that is merely
                    // re-rendered, and remounting is the one reliable way to
                    // fire the same one twice.
                    key={morphSignal}
                    // Selection-level keys land here because a selection across
                    // several rendered blocks belongs to none of them. No ref:
                    // containerRef is the outer shell and already contains these,
                    // so the block lookup queries down from there.
                    onKeyDown={onContainerKeyDown}
                    // Normal block flow (not flex) so each block's markdown
                    // margins collapse with its neighbours' exactly as they do
                    // in the rendered body — the editor then reads at the same
                    // vertical rhythm as the saved output, not looser.
                    className={cn(
                        "prose-editor px-3 py-2.5",
                        thinking && "ai-thinking",
                        // Only after a rewrite. On first mount the document is
                        // simply there and had nothing done to it.
                        morphSignal > 0 && "ai-morph",
                    )}
                    style={{ minHeight }}
                    onContextMenu={(e) => {
                        // Right-click in the empty gutter: open a block first.
                        if (blocks.length === 0) {
                            e.preventDefault()
                            startFirstBlock()
                            setMenu({ x: e.clientX, y: e.clientY })
                        }
                    }}
                >
                    {blocks.length === 0 ? (
                        <button
                            type="button"
                            onClick={startFirstBlock}
                            className="w-full cursor-text rounded-[6px] px-1 py-1 text-left text-[13px] text-[color:var(--c-text-dim)]"
                        >
                            {placeholder}
                        </button>
                    ) : (
                        blocks.map((b, i) =>
                            b.id === activeId ? (
                                <textarea
                                    key={b.id}
                                    ref={activeRef}
                                    value={b.text}
                                    onChange={(e) => {
                                        setActiveText(b.id, e.target.value)
                                        autosize(e.target)
                                    }}
                                    onKeyDown={(e) => onBlockKeyDown(e, b)}
                                    onContextMenu={(e) => {
                                        e.preventDefault()
                                        setMenu({ x: e.clientX, y: e.clientY })
                                    }}
                                    rows={1}
                                    spellCheck
                                    aria-label={ariaLabel}
                                    // my-0.5 stands in for the prose margin the
                                    // rendered form of this block would have —
                                    // a textarea can't margin-collapse with its
                                    // siblings, so the rhythm is matched by hand.
                                    // It must equal .prose-editor's paragraph
                                    // margin or a block would jump as you focus it.
                                    // break-words: a textarea wraps on spaces by
                                    // default, so a pasted URL would scroll the
                                    // editor sideways exactly as the rendered
                                    // block did before overflow-wrap was set.
                                    //
                                    // Face and size match RenderedBlock exactly —
                                    // 13px in the UI font, not 12.5px mono. This
                                    // is the SAME LINE in both states, and
                                    // swapping typeface on focus changed the width
                                    // of every word and re-wrapped the line under
                                    // the cursor: the text moved as you clicked
                                    // into it. Monospace still belongs in Source
                                    // mode, where you really are reading source.
                                    className="my-0.5 block w-full resize-none overflow-hidden break-words bg-transparent text-[13px] leading-6 text-[color:var(--c-text)] outline-none placeholder:text-[color:var(--c-text-dim)]"
                                />
                            ) : (
                                <RenderedBlock
                                    key={b.id}
                                    id={b.id}
                                    // Capped: a long document should still land
                                    // in well under a second, so past the tenth
                                    // block everything arrives together.
                                    index={Math.min(i, 10)}
                                    text={b.text}
                                    embeds={mergedEmbeds}
                                    onActivate={() => activate(b.id, b.text.length)}
                                    onContext={(x, y) => {
                                        activate(b.id, b.text.length)
                                        setMenu({ x, y })
                                    }}
                                />
                            ),
                        )
                    )}
                </div>
            )}

            {menu ? (
                <ContextStrip
                    x={menu.x}
                    y={menu.y}
                    onFormat={applyFormat}
                    onClose={() => setMenu(null)}
                    onAddComponent={projectId ? openPickerFromMenu : undefined}
                />
            ) : null}
        </div>
    )
}

// ---- pieces ---------------------------------------------------------------

interface Tool {
    key: string
    label: string
    glyph: React.ReactNode
    /** Pure — no refs. The ref-reading handler is attached at the call site so
     *  building this list never touches a ref during render. */
    format: (s: Selection) => Selection
}

const TOOLS: Tool[] = [
    { key: "bold", label: "Bold", glyph: <span className="font-black">B</span>, format: bold },
    { key: "italic", label: "Italic", glyph: <span className="font-serif italic">I</span>, format: italic },
    { key: "heading", label: "Heading", glyph: <span className="font-bold">H</span>, format: cycleHeading },
    { key: "code", label: "Inline code", glyph: <span className="font-mono text-[10px]">{"</>"}</span>, format: inlineCode },
    { key: "quote", label: "Quote", glyph: <span className="font-serif text-[15px] leading-none">&rdquo;</span>, format: toggleQuote },
    { key: "list", label: "Bulleted list", glyph: <ListGlyph />, format: toggleBulletList },
    { key: "link", label: "Link", glyph: <LinkGlyph />, format: insertLink },
]

function ToolButton({ label, glyph, onRun }: { label: string; glyph: React.ReactNode; onRun: () => void }) {
    return (
        <button
            type="button"
            // preventDefault keeps the active block focused and its selection intact.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onRun}
            title={label}
            aria-label={label}
            className="grid h-7 w-7 place-items-center rounded-md text-[12.5px] text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
        >
            {glyph}
        </button>
    )
}

function Divider() {
    return <span className="mx-0.5 h-4 w-px bg-[color:var(--c-border)]" aria-hidden />
}

function RenderedBlock({
    id,
    index,
    text,
    embeds,
    onActivate,
    onContext,
}: {
    /** Stamped into the DOM as data-block-id. A browser selection is a Range
     *  over nodes, and this is what maps the nodes it touches back to the
     *  blocks the editor is holding. */
    id: string
    /** Position in the stagger — see the .ai-morph rule. */
    index: number
    text: string
    embeds: SignedEmbedMap
    onActivate: () => void
    onContext: (x: number, y: number) => void
}) {
    return (
        <div
            data-block-id={id}
            style={{ "--i": index } as React.CSSProperties}
            role="button"
            tabIndex={0}
            onClick={(e) => {
                // Let links inside the rendered block do their job.
                if ((e.target as HTMLElement).closest("a")) return
                onActivate()
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault()
                    onActivate()
                }
            }}
            onContextMenu={(e) => {
                e.preventDefault()
                onContext(e.clientX, e.clientY)
            }}
            // Horizontal padding only: vertical padding would create a block
            // formatting context and stop this block's markdown margins from
            // collapsing with the next block's, reintroducing the extra gap.
            className="prose-tracker -mx-1 cursor-text rounded-[6px] px-1 text-[13px] leading-6 text-[color:var(--c-text)] hover:bg-[color:var(--c-overlay)]/50"
        >
            <MarkdownBody embeds={embeds}>{text}</MarkdownBody>
        </div>
    )
}

function ContextStrip({
    x,
    y,
    onFormat,
    onClose,
    onAddComponent,
}: {
    x: number
    y: number
    onFormat: (fn: (s: Selection) => Selection) => void
    onClose: () => void
    onAddComponent?: () => void
}) {
    const ref = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState({ left: x, top: y })

    useEffect(() => {
        const el = ref.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const left = Math.min(x, window.innerWidth - r.width - 8)
        const top = Math.min(y, window.innerHeight - r.height - 8)
        setPos({ left: Math.max(8, left), top: Math.max(8, top) })
    }, [x, y])

    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (!ref.current?.contains(e.target as Node)) onClose()
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose()
        }
        document.addEventListener("mousedown", onDown)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDown)
            document.removeEventListener("keydown", onKey)
        }
    }, [onClose])

    return createPortal(
        <div
            ref={ref}
            role="menu"
            aria-label="Formatting"
            style={{ left: pos.left, top: pos.top }}
            className="fixed z-50 flex items-center gap-0.5 rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-1 shadow-[var(--shadow-pop)]"
        >
            {TOOLS.map((t) => (
                <button
                    key={t.key}
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                        onFormat(t.format)
                        onClose()
                    }}
                    title={t.label}
                    aria-label={t.label}
                    className="grid h-7 w-7 place-items-center rounded-md text-[12.5px] text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                >
                    {t.glyph}
                </button>
            ))}
            {onAddComponent ? (
                <>
                    <Divider />
                    <button
                        type="button"
                        role="menuitem"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={onAddComponent}
                        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-semibold text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                    >
                        <ComponentGlyph />
                        Add component
                    </button>
                </>
            ) : null}
        </div>,
        document.body,
    )
}

// ---- helpers --------------------------------------------------------------

function autosize(el: HTMLTextAreaElement) {
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
}

function queueCaret(el: HTMLTextAreaElement, start: number, end: number = start) {
    requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start, end)
        autosize(el)
    })
}

function ListGlyph() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="2.5" cy="4" r="1.1" fill="currentColor" />
            <circle cx="2.5" cy="8" r="1.1" fill="currentColor" />
            <circle cx="2.5" cy="12" r="1.1" fill="currentColor" />
            <path d="M6 4h7.5M6 8h7.5M6 12h7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
    )
}

function LinkGlyph() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
                d="M6.5 9.5 9.5 6.5M6 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M10 11.5l-1 1A2.5 2.5 0 0 1 5.5 9l1-1"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function ComponentGlyph() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M1.75 10.25 5.5 6.75l3.25 3 2-1.75 3.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="10.25" cy="5.5" r="1.15" fill="currentColor" />
        </svg>
    )
}

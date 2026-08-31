"use client"

import { useCallback, useState } from "react"
import { compressImage, type CompressedImage } from "@/lib/client/image-compress"
import { cn } from "@/components/ui/cn"

// Screenshots attached to a draft, and the chips that show them.
//
// They exist for ONE reader: the AI draft pass. A screenshot of the broken
// screen says more about a bug than a paragraph describing it, and the compose
// endpoint already accepts images — it was just locked inside a separate modal
// that you had to decide to use before you had written anything.
//
// Deliberately NOT part of the persisted draft. These are base64 data URIs of
// up to six images; localStorage is a ~5MB budget shared by every draft of
// every project, and one screenshot would evict the text of all of them. They
// live for as long as the composer is open, which is as long as they are
// useful.

export const MAX_ATTACHMENTS = 6

export function useIssueAttachments() {
    const [images, setImages] = useState<CompressedImage[]>([])
    const [error, setError] = useState<string | null>(null)

    const addFiles = useCallback(async (fileList: FileList | File[] | null) => {
        if (!fileList) return
        setError(null)
        const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"))
        if (files.length === 0) return
        // Read the cap off the CURRENT state inside the updater rather than
        // closing over `images`: two drops in flight at once would otherwise
        // both see the old length and together overshoot the limit.
        let rejected = 0
        try {
            const compressed = await Promise.all(files.map((f) => compressImage(f)))
            setImages((cur) => {
                const room = MAX_ATTACHMENTS - cur.length
                rejected = Math.max(0, compressed.length - room)
                return [...cur, ...compressed.slice(0, Math.max(0, room))]
            })
            if (rejected > 0) setError(`Up to ${MAX_ATTACHMENTS} images — ${rejected} left out.`)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't read one of those images.")
        }
    }, [])

    const remove = useCallback((idx: number) => {
        setImages((cur) => cur.filter((_, i) => i !== idx))
        setError(null)
    }, [])

    const clear = useCallback(() => {
        setImages([])
        setError(null)
    }, [])

    return { images, addFiles, remove, clear, error }
}

/** True when a drag carries FILES, as opposed to text or the app's own issue
 *  drags. Checked so the composer only shows a drop affordance for something it
 *  can actually accept. */
export function isFileDrag(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes("Files")
}

export function AttachmentChips({
    images,
    onRemove,
    className,
}: {
    images: CompressedImage[]
    onRemove: (idx: number) => void
    className?: string
}) {
    if (images.length === 0) return null
    return (
        <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
            {images.map((img, i) => (
                <span
                    key={`${img.bytes}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface)] py-[3px] pl-[3px] pr-1.5 text-[12px] font-medium text-[color:var(--c-text)]"
                >
                    {/* The thumbnail IS the label. A filename would be a lie —
                        these are re-encoded JPEGs, not the file you dropped —
                        and "image 2" tells you nothing about which one it is. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={img.dataUrl}
                        alt=""
                        className="h-5 w-5 shrink-0 rounded-full object-cover"
                    />
                    <span className="text-[color:var(--c-text-muted)]">{formatBytes(img.bytes)}</span>
                    <button
                        type="button"
                        onClick={() => onRemove(i)}
                        aria-label={`Remove attached image ${i + 1}`}
                        className="grid h-4 w-4 place-items-center rounded-full text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                    >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </span>
            ))}
        </div>
    )
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

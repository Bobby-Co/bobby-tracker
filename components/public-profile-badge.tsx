"use client"

import { useEffect, useRef, useState } from "react"
import { readName, writeName } from "@/lib/public-profile"

// Anonymous profile pill at the top of /p/<token>. Reads the name
// from localStorage (synced across tabs + intra-tab via the custom
// "bobby:profile-changed" event) and lets the user inline-edit it.
// Empty name renders as "Anonymous" and submissions go through
// without a name attribution.
export function PublicProfileBadge({
    onNameChange,
}: {
    onNameChange?: (name: string) => void
}) {
    const [name, setName] = useState("")
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState("")
    const [hydrated, setHydrated] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const initial = readName()
        setName(initial)
        setHydrated(true)
        onNameChange?.(initial)

        function reread() {
            const n = readName()
            setName(n)
            onNameChange?.(n)
        }
        window.addEventListener("storage", reread)
        window.addEventListener("bobby:profile-changed", reread as EventListener)
        return () => {
            window.removeEventListener("storage", reread)
            window.removeEventListener("bobby:profile-changed", reread as EventListener)
        }
    }, [onNameChange])

    useEffect(() => {
        if (editing) {
            setDraft(name)
            requestAnimationFrame(() => inputRef.current?.select())
        }
    }, [editing, name])

    function commit() {
        writeName(draft)
        const finalName = draft.trim().slice(0, 80)
        setName(finalName)
        onNameChange?.(finalName)
        setEditing(false)
    }

    function clearName() {
        writeName("")
        setName("")
        onNameChange?.("")
    }

    // Hold layout to avoid hydration flash.
    if (!hydrated) {
        return <div className="h-9" aria-hidden />
    }

    return (
        <div className="flex flex-wrap items-center gap-2 rounded-full border border-[color:var(--c-border)] bg-white px-3 py-1.5 text-[12.5px]">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-900 text-[11px] font-bold text-white">
                {name ? name.trim().charAt(0).toUpperCase() : "?"}
            </span>
            {editing ? (
                <form
                    onSubmit={(e) => { e.preventDefault(); commit() }}
                    className="flex items-center gap-2"
                >
                    <input
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={80}
                        placeholder="Your name"
                        className="rounded-md border border-[color:var(--c-border)] bg-white px-2 py-0.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-zinc-900/15"
                    />
                    <button type="submit" className="text-[12px] font-semibold text-zinc-900 hover:underline">
                        Save
                    </button>
                    <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="text-[12px] text-[color:var(--c-text-muted)] hover:underline"
                    >
                        Cancel
                    </button>
                </form>
            ) : (
                <>
                    <span className="text-[color:var(--c-text-muted)]">Submitting as</span>
                    <span className="font-semibold text-[color:var(--c-text)]">
                        {name || "Anonymous"}
                    </span>
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="text-[12px] font-semibold text-zinc-900 hover:underline"
                    >
                        {name ? "Edit" : "Set name"}
                    </button>
                    {name && (
                        <button
                            type="button"
                            onClick={clearName}
                            className="text-[12px] text-[color:var(--c-text-muted)] hover:underline"
                            title="Clear saved name"
                        >
                            Clear
                        </button>
                    )}
                </>
            )}
        </div>
    )
}

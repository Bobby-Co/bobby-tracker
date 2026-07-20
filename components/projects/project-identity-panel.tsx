"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/components/ui/cn"
import { IconlyIcon } from "@/components/icons/iconly-icon"
import { IconPicker } from "@/components/icons/icon-picker"
import { createClient } from "@/lib/supabase/client"
import { ApiError, apiMutate } from "@/lib/api-client"

// ProjectIdentityPanel — rename a project, edit its description, and give it an
// icon.
//
// All three write through PATCH /api/projects/[id]. The icon lives in the
// selection modal (IconPicker), which leads with a "Suggested for …" row keyed
// off the description (falling back to the name) — the same local + semantic
// engine the labels use. router.refresh() after each save so the
// header/tile/breadcrumb re-fetch and reflect the change.
export function ProjectIdentityPanel({ projectId }: { projectId: string }) {
    const router = useRouter()

    const [loaded, setLoaded] = useState(false)
    const [name, setName] = useState("")
    const [savedName, setSavedName] = useState("")
    const [description, setDescription] = useState("")
    const [savedDescription, setSavedDescription] = useState("")
    const [iconName, setIconName] = useState<string | null>(null)
    const [pickerOpen, setPickerOpen] = useState(false)
    const [savingText, setSavingText] = useState(false)
    const [savingIcon, setSavingIcon] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    // Load current name + description + icon straight from the row (same
    // browser-client read DangerZonePanel uses). Selecting icon_name would error
    // if 0050 hasn't been applied yet, so fall back to a name+description read —
    // rename/description still work, the icon just shows unset until it lands.
    useEffect(() => {
        let cancelled = false
        const hydrate = (nm: string | undefined, desc: string | null | undefined, icon: string | null) => {
            setName(nm ?? "")
            setSavedName(nm ?? "")
            setDescription(desc ?? "")
            setSavedDescription(desc ?? "")
            setIconName(icon)
            setLoaded(true)
        }
        void (async () => {
            const supabase = createClient()
            const withIcon = await supabase
                .from("projects")
                .select("name, description, icon_name")
                .eq("id", projectId)
                .maybeSingle<{ name: string; description: string | null; icon_name: string | null }>()
            if (cancelled) return
            if (!withIcon.error) {
                hydrate(withIcon.data?.name, withIcon.data?.description, withIcon.data?.icon_name ?? null)
                return
            }
            const legacy = await supabase
                .from("projects")
                .select("name, description")
                .eq("id", projectId)
                .maybeSingle<{ name: string; description: string | null }>()
            if (cancelled) return
            hydrate(legacy.data?.name, legacy.data?.description, null)
        })()
        return () => {
            cancelled = true
        }
    }, [projectId])

    const trimmedName = name.trim()
    const nameDirty = trimmedName.length > 0 && trimmedName !== savedName.trim()
    const descDirty = description !== savedDescription
    const textDirty = nameDirty || descDirty
    // Seed for the icon suggestions — the description says the most about what
    // the project is; fall back to the name when it's blank.
    const suggestSeed = description.trim() || trimmedName

    async function patch(body: Record<string, unknown>): Promise<boolean> {
        try {
            await apiMutate(`/api/projects/${projectId}`, { method: "PATCH", body })
            return true
        } catch (e) {
            // Network errors propagate to the caller's try/catch (as before);
            // a server error sets the inline message and returns false.
            if (!(e instanceof ApiError)) throw e
            setErr(e.message || `Failed (${e.status})`)
            return false
        }
    }

    async function saveText() {
        if (!textDirty || savingText) return
        setErr(null)
        setSavingText(true)
        try {
            const body: Record<string, unknown> = {}
            if (nameDirty) body.name = trimmedName
            if (descDirty) body.description = description
            if (await patch(body)) {
                if (nameDirty) setSavedName(trimmedName)
                if (descDirty) setSavedDescription(description)
                router.refresh()
            }
        } catch {
            setErr("Network error")
        } finally {
            setSavingText(false)
        }
    }

    async function saveIcon(next: string | null) {
        if (savingIcon) return
        setErr(null)
        setSavingIcon(true)
        const prev = iconName
        setIconName(next) // optimistic
        try {
            if (await patch({ icon_name: next })) {
                router.refresh()
            } else {
                setIconName(prev)
            }
        } catch {
            setIconName(prev)
            setErr("Network error")
        } finally {
            setSavingIcon(false)
        }
    }

    return (
        <>
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-5">
                <div className="flex items-start gap-4">
                    {/* Icon — click to open the picker (which leads with suggestions). */}
                    <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        disabled={!loaded}
                        title="Change icon"
                        className={cn(
                            "group relative grid h-14 w-14 shrink-0 place-items-center rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-[color:var(--c-text)] transition-colors hover:border-zinc-400 disabled:opacity-50",
                            savingIcon && "opacity-60",
                        )}
                    >
                        {iconName ? (
                            <IconlyIcon name={iconName} size={26} />
                        ) : (
                            <span className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--c-text-dim)]">
                                {savedName ? savedName[0] : "?"}
                            </span>
                        )}
                        <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-[color:var(--c-border)] bg-white text-[color:var(--c-text-muted)] shadow-sm">
                            <PencilIcon />
                        </span>
                    </button>

                    <div className="min-w-0 flex-1">
                        <label className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                            Project name
                        </label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && textDirty) {
                                    e.preventDefault()
                                    void saveText()
                                }
                            }}
                            disabled={!loaded}
                            placeholder="Project name"
                            className="w-full rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[13px] outline-none focus:border-zinc-400 disabled:opacity-50"
                        />

                        <label className="mb-1.5 mt-3 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                            Description
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={!loaded}
                            rows={2}
                            placeholder="One-liner about what this project tracks — also seeds the icon suggestions."
                            className="w-full resize-y rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[13px] leading-5 outline-none focus:border-zinc-400 disabled:opacity-50"
                        />

                        <div className="mt-3 flex items-center gap-3">
                            <button
                                type="button"
                                onClick={saveText}
                                disabled={!textDirty || savingText}
                                className="rounded-[10px] bg-zinc-900 px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {savingText ? "Saving…" : "Save"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setPickerOpen(true)}
                                disabled={!loaded}
                                className="rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[12px] font-semibold hover:bg-[color:var(--c-overlay)] disabled:opacity-50"
                            >
                                Change icon
                            </button>
                            {iconName && (
                                <button
                                    type="button"
                                    onClick={() => saveIcon(null)}
                                    disabled={savingIcon}
                                    className="text-[12px] font-semibold text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)] disabled:opacity-50"
                                >
                                    Reset icon
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {err && <p className="mt-3 text-[12px] text-rose-700">{err}</p>}
            </div>

            <IconPicker
                open={pickerOpen}
                label={savedName || "this project"}
                current={iconName}
                suggestFor={suggestSeed}
                onClose={() => setPickerOpen(false)}
                onPick={(n) => {
                    void saveIcon(n)
                    setPickerOpen(false)
                }}
            />
        </>
    )
}

function PencilIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
    )
}

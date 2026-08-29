"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/components/ui/cn"
import type { SignedEmbed } from "@/modules/embeds/domain/SignedEmbed"
import type { ZooComponent } from "@/modules/embeds/domain/ZooComponent"

// "Embed from Zoo" — the popover an author picks a component from.
//
// The list is Zoo's real component catalogue for this project's repo, read
// through our own access-checked route. Picking one MINTS: Zoo asks the
// developer's daemon to render that component headlessly and freezes the result
// as an immutable image. That is why a click costs a second or two, and why the
// popover cares whether the daemon is online — the catalogue is served from
// Zoo's cache and stays browsable while the developer's laptop is shut, so a
// list you can read is not automatically a list you can mint from.

interface CatalogueResponse {
    configured: boolean
    online: boolean
    project?: string
    components: ZooComponent[]
    /** Components that exist but have no doc page — they cannot be pinned. */
    undocumented?: number
    reason?: string
    /** Present when the repo's owner has not approved this project — the link
     *  that lets them. */
    connectUrl?: string | null
}

export function EmbedPicker({
    projectId,
    onInsert,
    className,
}: {
    projectId: string
    /** Called with the freshly minted, signed embed. The caller writes the
     *  reference into the body — this component never touches the text. */
    onInsert: (embed: SignedEmbed) => void
    className?: string
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [minting, setMinting] = useState<string | null>(null)
    const [mintError, setMintError] = useState<string | null>(null)

    const triggerRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)
    const panelId = useId()

    const [portalReady, setPortalReady] = useState(false)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => setPortalReady(true), [])
    const [pos, setPos] = useState({ top: 0, left: 0 })

    const close = useCallback(() => {
        setOpen(false)
        setQuery("")
        setMintError(null)
    }, [])

    // Load on open, not on mount: an author who never reaches for an embed
    // should not make their issue page call Zoo.
    useEffect(() => {
        if (!open || catalogue !== null) return
        let cancelled = false
        fetch(`/api/projects/${projectId}/embeds`, { credentials: "same-origin" })
            .then((r) => (r.ok ? (r.json() as Promise<CatalogueResponse>) : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((body) => {
                if (!cancelled) setCatalogue(body)
            })
            .catch(() => {
                if (!cancelled) {
                    setCatalogue({ configured: true, online: false, components: [] })
                    setLoadError("Couldn't reach Zoo.")
                }
            })
        return () => {
            cancelled = true
        }
    }, [open, catalogue, projectId])

    useEffect(() => {
        if (!open) return
        function onDown(e: MouseEvent) {
            const target = e.target as Node
            if (triggerRef.current?.contains(target)) return
            if (panelRef.current?.contains(target)) return
            close()
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") {
                close()
                triggerRef.current?.focus()
            }
        }
        document.addEventListener("mousedown", onDown)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDown)
            document.removeEventListener("keydown", onKey)
        }
    }, [open, close])

    useEffect(() => {
        if (!open) return
        function update() {
            const r = triggerRef.current?.getBoundingClientRect()
            if (!r) return
            const width = 340
            const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
            setPos({ top: r.bottom + 6, left })
        }
        update()
        window.addEventListener("scroll", update, true)
        window.addEventListener("resize", update)
        return () => {
            window.removeEventListener("scroll", update, true)
            window.removeEventListener("resize", update)
        }
    }, [open])

    // Guard the shape rather than trusting the payload: an entry without an id
    // is unusable (it keys the list AND is what we mint), and React silently
    // degrades to index keys when one is undefined instead of failing loudly.
    const components = useMemo(
        () => (catalogue?.components ?? []).filter((c) => typeof c?.id === "string" && c.id.length > 0),
        [catalogue],
    )
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return components
        return components.filter((c) =>
            [c.name, c.id, c.file].some((field) => (field ?? "").toLowerCase().includes(q)),
        )
    }, [components, query])

    async function pick(component: ZooComponent) {
        setMinting(component.id)
        setMintError(null)
        try {
            const res = await fetch(`/api/projects/${projectId}/embeds`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ componentId: component.id }),
            })
            const body = (await res.json()) as { embed?: SignedEmbed; error?: { message?: string } }
            if (!res.ok || !body.embed) {
                setMintError(body?.error?.message || `Couldn't embed that (HTTP ${res.status}).`)
                return
            }
            onInsert(body.embed)
            close()
            triggerRef.current?.focus()
        } catch {
            setMintError("Couldn't reach the server.")
        } finally {
            setMinting(null)
        }
    }

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => {
                    if (open) close()
                    else {
                        setOpen(true)
                        requestAnimationFrame(() => searchRef.current?.focus())
                    }
                }}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-controls={open ? panelId : undefined}
                className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-semibold text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]",
                    open && "bg-[color:var(--c-overlay)] text-[color:var(--c-text)]",
                    className,
                )}
            >
                <ComponentIcon />
                Embed from Zoo
            </button>

            {open && portalReady
                ? createPortal(
                      <div
                          ref={panelRef}
                          id={panelId}
                          role="dialog"
                          aria-label="Embed a Zoo component"
                          style={{ top: pos.top, left: pos.left, width: 340 }}
                          className="fixed z-50 flex max-h-[400px] flex-col overflow-hidden rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] shadow-[var(--shadow-card)]"
                      >
                          <div className="border-b border-[color:var(--c-border)] p-2">
                              <input
                                  ref={searchRef}
                                  value={query}
                                  onChange={(e) => setQuery(e.target.value)}
                                  placeholder="Search components"
                                  className="input h-8 w-full text-[12px]"
                                  aria-label="Search components"
                                  disabled={!!minting}
                              />
                          </div>

                          {/* Browsable but unmintable is a real state, and the
                              author needs to know BEFORE clicking. */}
                          {catalogue && catalogue.configured && !catalogue.online && components.length > 0 ? (
                              <p className="border-b border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2 text-[11px] leading-snug text-[color:var(--c-text-muted)]">
                                  The Zoo daemon for this repo is offline. Embedding needs it
                                  running — start it to pin a component.
                              </p>
                          ) : null}

                          <div className="min-h-0 flex-1 overflow-y-auto p-2">
                              {catalogue === null ? (
                                  <div className="flex flex-col gap-1.5">
                                      <div className="skeleton h-9 rounded-[8px]" />
                                      <div className="skeleton h-9 rounded-[8px]" />
                                      <div className="skeleton h-9 rounded-[8px]" />
                                  </div>
                              ) : !catalogue.configured ? (
                                  <Notice>Zoo embeds aren&apos;t configured for this deployment yet.</Notice>
                              ) : catalogue.reason === "no-repo" ? (
                                  <Notice>Link this project to a repository to embed its components.</Notice>
                              ) : catalogue.reason === "not-connected" ? (
                                  <div className="flex flex-col items-center gap-2 px-2 py-5 text-center">
                                      <p className="text-[12px] leading-relaxed text-[color:var(--c-text-muted)]">
                                          This project isn&apos;t connected to Zoo yet. The owner of this
                                          repository has to approve it.
                                      </p>
                                      {catalogue.connectUrl ? (
                                          <a
                                              // A new tab, and the current URL as the return address:
                                              // approving happens on Zoo, and the author should come
                                              // back to the issue they were writing.
                                              href={`${catalogue.connectUrl}&redirect=${encodeURIComponent(
                                                  typeof window === "undefined" ? "" : window.location.href,
                                              )}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="btn-primary text-[11.5px]"
                                          >
                                              Connect in Zoo
                                          </a>
                                      ) : null}
                                  </div>
                              ) : catalogue.reason === "no-zoo-project" ? (
                                  <Notice>Zoo has no project for this repository yet.</Notice>
                              ) : filtered.length === 0 ? (
                                  <Notice>
                                      {query.trim()
                                          ? "No components match."
                                          : catalogue.undocumented
                                            ? // The distinction that matters: the project HAS components,
                                              // they just have no doc page, so there are no props to
                                              // render them with. Sends the author to Zoo, not to support.
                                              `${catalogue.undocumented} component${catalogue.undocumented === 1 ? "" : "s"} in this project ${catalogue.undocumented === 1 ? "has" : "have"} no doc page yet. Document them in Zoo to embed them.`
                                            : "This project has no components in Zoo."}
                                  </Notice>
                              ) : (
                                  <ul className="flex flex-col gap-0.5">
                                      {filtered.map((component) => (
                                          <li key={component.id}>
                                              <button
                                                  type="button"
                                                  onClick={() => void pick(component)}
                                                  disabled={!!minting || !catalogue.online}
                                                  className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-[color:var(--c-overlay)] disabled:cursor-not-allowed disabled:opacity-50"
                                              >
                                                  <Thumbnail projectId={projectId} componentId={component.id} />
                                                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                      <span className="flex items-center gap-2">
                                                          <span className="truncate text-[12.5px] font-semibold text-[color:var(--c-text)]">
                                                              {component.name}
                                                          </span>
                                                          {minting === component.id ? (
                                                              <span className="shrink-0 text-[10.5px] font-semibold text-[color:var(--c-text-muted)]">
                                                                  rendering…
                                                              </span>
                                                          ) : null}
                                                      </span>
                                                      {component.description || component.file ? (
                                                          <span className="truncate text-[10.5px] text-[color:var(--c-text-dim)]">
                                                              {component.description || component.file}
                                                          </span>
                                                      ) : null}
                                                  </span>
                                              </button>
                                          </li>
                                      ))}
                                  </ul>
                              )}

                              {mintError ? <p className="mt-2 text-[11.5px] text-rose-600">{mintError}</p> : null}
                              {loadError ? (
                                  <p className="mt-2 text-[11.5px] text-[color:var(--c-text-dim)]">{loadError}</p>
                              ) : null}
                          </div>

                          <p className="border-t border-[color:var(--c-border)] px-3 py-2 text-[10.5px] leading-snug text-[color:var(--c-text-dim)]">
                              Picking one renders it in Zoo and pins the image — it won&apos;t change
                              when the component does.
                          </p>
                      </div>,
                      document.body,
                  )
                : null}
        </>
    )
}

/** One component's preview.
 *
 *  Zoo renders these lazily on the developer's machine, so the first look at a
 *  component answers 202 ("started"). We retry a few times with a widening gap
 *  rather than showing a permanent blank: the render usually lands within a
 *  second or two, and giving up immediately would mean the picker only ever
 *  previewed components someone happened to open in the studio before.
 *
 *  The bytes come from the SAME fetch that reads the status, held as an object
 *  URL. Putting the endpoint in `<img src>` instead would request every
 *  thumbnail twice — once to learn it was ready, once to draw it — and each of
 *  those is a tunnelled round trip to someone's laptop.
 *
 *  A component with no preview keeps its name and description, so the list is
 *  never worse than it was before previews existed. */
function Thumbnail({ projectId, componentId }: { projectId: string; componentId: string }) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    const [done, setDone] = useState(false)

    useEffect(() => {
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let created: string | null = null

        const ask = async (attempt: number) => {
            try {
                const res = await fetch(
                    `/api/projects/${projectId}/embeds/thumb?componentId=${encodeURIComponent(componentId)}`,
                    { credentials: "same-origin" },
                )
                if (cancelled) return
                if (res.status === 202) {
                    // Still rendering. Back off 1s, 2s, 3s, then stop asking.
                    if (attempt < 3) timer = setTimeout(() => void ask(attempt + 1), 1000 * (attempt + 1))
                    else setDone(true)
                    return
                }
                if (!res.ok) {
                    setDone(true)
                    return
                }
                const blob = await res.blob()
                if (cancelled) return
                created = URL.createObjectURL(blob)
                setObjectUrl(created)
                setDone(true)
            } catch {
                if (!cancelled) setDone(true)
            }
        }
        void ask(0)

        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
            // Object URLs pin their blob in memory until revoked, and a picker
            // opened repeatedly would accumulate one per component per open.
            if (created) URL.revokeObjectURL(created)
        }
    }, [projectId, componentId])

    return (
        <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]">
            {objectUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={objectUrl} alt="" decoding="async" className="max-h-full max-w-full object-contain" />
            ) : !done ? (
                <span className="h-4 w-8 animate-pulse rounded bg-[color:var(--c-border)]" />
            ) : null}
        </span>
    )
}

function Notice({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-[color:var(--c-text-muted)]">
            {children}
        </p>
    )
}

function ComponentIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M1.75 10.25 5.5 6.75l3.25 3 2-1.75 3.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="10.25" cy="5.5" r="1.15" fill="currentColor" />
        </svg>
    )
}

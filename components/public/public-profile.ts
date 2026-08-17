// Browser-only helpers for the anonymous "profile" used by /p/<token>
// submitters. The display name and stable reporter id live at single
// global keys so a submitter who fills them once on one public link
// reuses them on every other public link they visit. Submission
// history is no longer kept here — the public page server-renders
// "All submissions" grouped by reporter, which gives every visitor
// the same view regardless of device.

const NAME_KEY = "bobby:public-profile:name"
const REPORTER_ID_KEY = "bobby:public-profile:reporter-id"

export function readName(): string {
    if (typeof window === "undefined") return ""
    try { return localStorage.getItem(NAME_KEY) ?? "" } catch { return "" }
}

// Stable per-browser id used to distinguish anonymous submitters on
// the public listing. Generated lazily on first call and persisted
// to localStorage; same id is reused across every public session
// the submitter visits.
export function readReporterId(): string {
    if (typeof window === "undefined") return ""
    try {
        let id = localStorage.getItem(REPORTER_ID_KEY)
        if (!id) {
            id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
                ? crypto.randomUUID()
                : Math.random().toString(36).slice(2) + Date.now().toString(36)
            localStorage.setItem(REPORTER_ID_KEY, id)
        }
        return id
    } catch { return "" }
}

export function writeName(name: string) {
    if (typeof window === "undefined") return
    try {
        const trimmed = name.trim().slice(0, 80)
        if (trimmed) localStorage.setItem(NAME_KEY, trimmed)
        else localStorage.removeItem(NAME_KEY)
        // Notify any other listeners in the same tab (storage events
        // only fire cross-tab; we want intra-tab sync too).
        window.dispatchEvent(new CustomEvent("bobby:profile-changed"))
    } catch { /* quota or unavailable */ }
}

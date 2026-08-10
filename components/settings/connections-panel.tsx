"use client"

import { useState } from "react"
import { createClient } from "@/lib/client/supabase"
import { apiMutate } from "@/lib/client/http/api-client"
import { useApi } from "@/lib/client/hooks/use-api"
import { IconlyGithub } from "@/icons/Iconly-github-icon"
import { IconlyGitlab } from "@/icons/Iconly-gitlab-icon"

// Account-level VCS connections. Each provider can be connected independently
// (a user may link both GitHub and GitLab); the add-project repo picker then
// lists repos from every connected source. Connecting runs an OAuth round-trip
// back through /auth/callback, which persists the token; this panel re-reads
// /api/connections on the return.
//
// GitHub uses signInWithOAuth (the user's primary login for most accounts).
// GitLab uses linkIdentity so it's ADDED to the existing account rather than
// creating a separate user when the GitLab email differs — this requires
// "Manual Linking" to be enabled in the Supabase project.

interface ProviderStatus {
    connected: boolean
    login: string | null
}
interface ConnectionsResponse {
    providers: { github: ProviderStatus; gitlab: ProviderStatus }
}

const RETURN_PATH = "/settings/connections"

export function ConnectionsPanel() {
    const { data, loading, error, refetch } = useApi<ConnectionsResponse>("/api/connections")
    const [busy, setBusy] = useState<null | "github" | "gitlab">(null)
    const [actionError, setActionError] = useState<string | null>(null)

    function callbackUrl(params: Record<string, string>): string {
        const u = new URL("/auth/callback", window.location.origin)
        u.searchParams.set("next", RETURN_PATH)
        for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
        return u.href
    }

    async function connectGithub() {
        setActionError(null)
        setBusy("github")
        const supabase = createClient()
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "github",
            options: { redirectTo: callbackUrl({}), scopes: "repo read:user user:email" },
        })
        if (error) {
            setActionError(error.message)
            setBusy(null)
        }
        // On success the browser redirects to GitHub; nothing more to do here.
    }

    async function connectGitlab() {
        setActionError(null)
        setBusy("gitlab")
        const supabase = createClient()
        // linkIdentity ADDS the GitLab identity to the current account. The
        // ?connect=gitlab hint tells the callback to store the token in
        // provider_tokens (not github_tokens). `api` scope covers listing
        // projects now and provisioning the bot token + webhook later.
        const { error } = await supabase.auth.linkIdentity({
            provider: "gitlab",
            options: { redirectTo: callbackUrl({ connect: "gitlab" }), scopes: "api" },
        })
        if (error) {
            setActionError(
                `${error.message} — connecting GitLab needs "Manual Linking" enabled in Supabase.`,
            )
            setBusy(null)
        }
    }

    async function disconnect(provider: "github" | "gitlab") {
        setActionError(null)
        setBusy(provider)
        try {
            await apiMutate(`/api/connections/${provider}`, { method: "DELETE" })
            refetch()
        } catch (e) {
            setActionError((e as Error).message)
        } finally {
            setBusy(null)
        }
    }

    const github = data?.providers.github
    const gitlab = data?.providers.gitlab

    return (
        <div className="flex flex-col gap-3">
            {error && <p className="text-[12.5px] text-rose-700">{error}</p>}
            {actionError && (
                <p className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {actionError}
                </p>
            )}

            <ConnectionRow
                name="GitHub"
                icon={<IconlyGithub size={20} />}
                status={github}
                loading={loading}
                busy={busy === "github"}
                onConnect={connectGithub}
                onDisconnect={() => disconnect("github")}
            />
            <ConnectionRow
                name="GitLab"
                icon={<IconlyGitlab size={20} />}
                status={gitlab}
                loading={loading}
                busy={busy === "gitlab"}
                onConnect={connectGitlab}
                onDisconnect={() => disconnect("gitlab")}
            />
        </div>
    )
}

function ConnectionRow({
    name,
    icon,
    status,
    loading,
    busy,
    onConnect,
    onDisconnect,
}: {
    name: string
    icon: React.ReactNode
    status: ProviderStatus | undefined
    loading: boolean
    busy: boolean
    onConnect: () => void
    onDisconnect: () => void
}) {
    const connected = status?.connected ?? false
    return (
        <div className="flex items-center gap-3 rounded-[12px] border border-[color:var(--c-border)] bg-white px-4 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[color:var(--c-surface)] text-[color:var(--c-text)]">
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">{name}</div>
                <div className="text-[12px] text-[color:var(--c-text-muted)]">
                    {loading
                        ? "Checking…"
                        : connected
                          ? status?.login
                              ? `Connected as @${status.login}`
                              : "Connected"
                          : "Not connected"}
                </div>
            </div>
            {connected ? (
                <button
                    type="button"
                    onClick={onDisconnect}
                    disabled={busy}
                    className="rounded-[9px] border border-[color:var(--c-border)] bg-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-[color:var(--c-surface)] disabled:opacity-60"
                >
                    {busy ? "…" : "Disconnect"}
                </button>
            ) : (
                <button
                    type="button"
                    onClick={onConnect}
                    disabled={busy || loading}
                    className="btn-primary py-1.5 text-[12.5px]"
                >
                    {busy ? "Connecting…" : "Connect"}
                </button>
            )}
        </div>
    )
}

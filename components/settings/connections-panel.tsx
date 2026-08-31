"use client"

import { useState } from "react"
import { createClient } from "@/lib/client/supabase"
import { apiMutate } from "@/lib/client/http/api-client"
import { useApi } from "@/lib/client/hooks/use-api"
import { IconlyGithub } from "@/icons/Iconly-github-icon"
import { IconlyGitlab } from "@/icons/Iconly-gitlab-icon"

// Account-level VCS connections. GitHub is a single github.com connection.
// GitLab is MULTI-INSTANCE because this is a public service: connect gitlab.com
// with one OAuth click, and/or add self-managed instances by pasting a token
// (the only mechanism that works across arbitrary hosts). The add-project repo
// picker then lists repos from every connected source.
//
// gitlab.com connect uses linkIdentity so GitLab is ADDED to the existing
// account rather than creating a second user — requires "Manual Linking" enabled
// in the Supabase project.

interface GitlabConnection {
    host: string
    login: string | null
    authKind: "oauth" | "pat"
}
interface ConnectionsResponse {
    providers: {
        // `stale` = a token is stored but GitHub no longer accepts it. Connected
        // in the database, useless in practice — the row still has to offer a
        // way back, which "Connected + Disconnect" alone did not.
        github: { connected: boolean; login: string | null; stale?: boolean }
        gitlab: { connections: GitlabConnection[] }
    }
}

const RETURN_PATH = "/settings/connections"

export function ConnectionsPanel() {
    const { data, loading, error, refetch } = useApi<ConnectionsResponse>("/api/connections")
    const [busy, setBusy] = useState<string | null>(null)
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
        // signInWithOAuth (not linkIdentity) because this doubles as RECONNECT:
        // GitHub tokens get revoked, and re-authorising an already-linked
        // identity is a sign-in, not a link. ?connect=github tells the callback
        // to capture the returned provider_token as the GitHub credential.
        const { error } = await createClient().auth.signInWithOAuth({
            provider: "github",
            options: {
                redirectTo: callbackUrl({ connect: "github" }),
                scopes: "repo read:user user:email",
            },
        })
        if (error) {
            setActionError(error.message)
            setBusy(null)
        }
    }

    async function connectGitlabCom() {
        setActionError(null)
        setBusy("gitlab-oauth")
        // linkIdentity ADDS the GitLab identity to the current account. The
        // ?connect=gitlab hint tells the callback to store the token in
        // provider_tokens (host gitlab.com). `api` scope covers listing projects
        // now and provisioning the bot token + webhook later.
        const { error } = await createClient().auth.linkIdentity({
            provider: "gitlab",
            options: { redirectTo: callbackUrl({ connect: "gitlab" }), scopes: "api" },
        })
        if (error) {
            const msg = error.message
            let hint = ""
            if (/not enabled|unsupported provider/i.test(msg)) {
                hint = " — enable the GitLab provider in Supabase (Authentication → Providers → GitLab)."
            } else if (/manual linking|linking is disabled|not enabled for manual/i.test(msg)) {
                hint = ' — enable "Manual Linking" in Supabase (Authentication settings).'
            }
            setActionError(msg + hint)
            setBusy(null)
        }
    }

    async function disconnect(provider: "github" | "gitlab", host?: string) {
        setActionError(null)
        setBusy(host ? `disc:${host}` : provider)
        try {
            const q = host ? `?host=${encodeURIComponent(host)}` : ""
            await apiMutate(`/api/connections/${provider}${q}`, { method: "DELETE" })
            refetch()
        } catch (e) {
            setActionError((e as Error).message)
        } finally {
            setBusy(null)
        }
    }

    const github = data?.providers.github
    const gitlab = data?.providers.gitlab.connections ?? []
    const hasGitlabCom = gitlab.some((c) => c.host === "gitlab.com")

    return (
        <div className="flex flex-col gap-5">
            {error && <p className="text-[12.5px] text-rose-700">{error}</p>}
            {actionError && (
                <p className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {actionError}
                </p>
            )}

            {/* GitHub — single connection */}
            <ConnectionRow
                name="GitHub"
                sub={
                    loading
                        ? "Checking…"
                        : github?.connected
                          ? github.stale
                              ? "GitHub rejected the stored token — reconnect to restore repo access"
                              : github.login
                                ? `Connected as @${github.login}`
                                : "Connected"
                          : "Not connected"
                }
                icon={<IconlyGithub size={20} />}
                action={
                    github?.connected && !github.stale ? (
                        <SmallButton onClick={() => disconnect("github")} busy={busy === "github"}>
                            Disconnect
                        </SmallButton>
                    ) : (
                        <PrimaryButton onClick={connectGithub} busy={busy === "github"} disabled={loading}>
                            {github?.stale ? "Reconnect" : "Connect"}
                        </PrimaryButton>
                    )
                }
            />

            {/* GitLab — multi-instance */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-0.5">
                    <span className="grid h-5 w-5 place-items-center text-[color:var(--c-text)]">
                        <IconlyGitlab size={16} />
                    </span>
                    <span className="text-[12px] font-semibold">GitLab</span>
                </div>

                {gitlab.map((c) => (
                    <ConnectionRow
                        key={c.host}
                        name={c.host}
                        sub={c.login ? `Connected as @${c.login}` : "Connected"}
                        badge={c.authKind === "oauth" ? "OAuth" : "Token"}
                        icon={<IconlyGitlab size={20} />}
                        action={
                            <SmallButton
                                onClick={() => disconnect("gitlab", c.host)}
                                busy={busy === `disc:${c.host}`}
                            >
                                Disconnect
                            </SmallButton>
                        }
                    />
                ))}

                {!loading && !hasGitlabCom && (
                    <div className="flex items-center justify-between gap-3 rounded-[12px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-4 py-3">
                        <div className="min-w-0">
                            <div className="text-[13px] font-semibold">gitlab.com</div>
                            <div className="text-[12px] text-[color:var(--c-text-muted)]">
                                One-click connect via OAuth
                            </div>
                        </div>
                        <PrimaryButton onClick={connectGitlabCom} busy={busy === "gitlab-oauth"}>
                            Connect
                        </PrimaryButton>
                    </div>
                )}

                <SelfManagedForm
                    busy={busy === "gitlab-pat"}
                    onSubmit={async (host, token) => {
                        setActionError(null)
                        setBusy("gitlab-pat")
                        try {
                            await apiMutate("/api/connections/gitlab", {
                                method: "POST",
                                body: { host, token },
                            })
                            refetch()
                            return true
                        } catch (e) {
                            setActionError((e as Error).message)
                            return false
                        } finally {
                            setBusy(null)
                        }
                    }}
                />
            </div>
        </div>
    )
}

// A self-managed GitLab instance is added by pasting a Personal/Project Access
// Token (scope `api`). We validate it against the instance before storing.
function SelfManagedForm({
    busy,
    onSubmit,
}: {
    busy: boolean
    onSubmit: (host: string, token: string) => Promise<boolean>
}) {
    const [open, setOpen] = useState(false)
    const [host, setHost] = useState("")
    const [token, setToken] = useState("")

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="self-start text-[12px] font-medium text-[color:var(--c-text-muted)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--c-text)]"
            >
                + Add a self-managed GitLab instance
            </button>
        )
    }

    return (
        <form
            onSubmit={async (e) => {
                e.preventDefault()
                const ok = await onSubmit(host.trim(), token.trim())
                if (ok) {
                    setHost("")
                    setToken("")
                    setOpen(false)
                }
            }}
            className="flex flex-col gap-2 rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-3"
        >
            <div className="text-[12.5px] font-semibold">Self-managed GitLab</div>
            <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="gitlab.your-company.com"
                className="input"
                autoFocus
            />
            <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Personal/Project Access Token (scope: api)"
                type="password"
                className="input"
            />
            <p className="text-[11px] text-[color:var(--c-text-muted)]">
                Create a token in your GitLab under Settings → Access Tokens with the{" "}
                <span className="font-mono">api</span> scope.
            </p>
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-[9px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-3 py-1.5 text-[12.5px] font-medium hover:bg-[color:var(--c-surface)]"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={busy || !host.trim() || !token.trim()}
                    className="btn-primary py-1.5 text-[12.5px]"
                >
                    {busy ? "Connecting…" : "Connect"}
                </button>
            </div>
        </form>
    )
}

function ConnectionRow({
    name,
    sub,
    icon,
    action,
    badge,
}: {
    name: string
    sub: string
    icon: React.ReactNode
    action: React.ReactNode
    badge?: string
}) {
    return (
        <div className="flex items-center gap-3 rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-4 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[color:var(--c-surface)] text-[color:var(--c-text)]">
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-semibold">{name}</span>
                    {badge && (
                        <span className="rounded-full bg-[color:var(--c-surface)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--c-text-muted)]">
                            {badge}
                        </span>
                    )}
                </div>
                <div className="truncate text-[12px] text-[color:var(--c-text-muted)]">{sub}</div>
            </div>
            {action}
        </div>
    )
}

function PrimaryButton({
    onClick,
    busy,
    disabled,
    children,
}: {
    onClick: () => void
    busy: boolean
    disabled?: boolean
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy || disabled}
            className="btn-primary py-1.5 text-[12.5px]"
        >
            {busy ? "Connecting…" : children}
        </button>
    )
}

function SmallButton({
    onClick,
    busy,
    children,
}: {
    onClick: () => void
    busy: boolean
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className="rounded-[9px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-3 py-1.5 text-[12.5px] font-medium hover:bg-[color:var(--c-surface)] disabled:opacity-60"
        >
            {busy ? "…" : children}
        </button>
    )
}

"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/client/supabase"
import { apiMutate } from "@/lib/client/http/api-client"
import { SetupWizard, type WizardDir, type WizardEffort } from "@/components/projects/setup-wizard"
import type { GithubSyncDirection } from "@/lib/shared/types"

// First-run setup wizard page. Thin: loads the project's current state, then
// renders <SetupWizard> (all the UI + animation) wired to the real APIs. The
// same component is exercised standalone at /preview/setup-wizard.
export default function SetupWizardPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    const [init, setInit] = useState<{
        name: string
        provider: "github" | "gitlab"
        installed: boolean
        dir: WizardDir
        autoUpdate: boolean
    } | null>(null)

    useEffect(() => {
        let cancelled = false
        void (async () => {
            const supabase = createClient()
            const { data } = await supabase
                .from("projects")
                .select("name,provider,github_installation_id,github_sync_enabled,github_sync_direction,auto_index_on_push")
                .eq("id", id)
                .maybeSingle<{
                    name: string
                    provider: "github" | "gitlab" | null
                    github_installation_id: number | null
                    github_sync_enabled: boolean
                    github_sync_direction: GithubSyncDirection
                    auto_index_on_push: boolean
                }>()
            if (cancelled) return
            const provider = data?.provider === "gitlab" ? "gitlab" : "github"
            // GitLab sync is auto-provisioned at create (no App install), so
            // "connected" means sync is enabled; GitHub means the App is linked.
            const installed =
                provider === "gitlab" ? !!data?.github_sync_enabled : !!data?.github_installation_id
            setInit({
                name: data?.name ?? "",
                provider,
                installed,
                dir: data?.github_sync_enabled ? (data.github_sync_direction as WizardDir) : "both",
                autoUpdate: data?.auto_index_on_push ?? true,
            })
        })()
        return () => {
            cancelled = true
        }
    }, [id])

    function saveGithub(dir: WizardDir) {
        // Fire-and-forget: swallow every outcome, as before.
        void apiMutate(`/api/projects/${id}/github-sync`, {
            method: "POST",
            body: dir === "off" ? { enabled: false } : { enabled: true, direction: dir },
        }).catch(() => {})
    }

    function saveAutoUpdate(on: boolean) {
        void apiMutate(`/api/projects/${id}`, {
            method: "PATCH",
            body: { auto_index_on_push: on },
        }).catch(() => {})
    }

    async function connect() {
        // GitLab has no App install — "connect" re-runs provisioning (mint bot
        // token + register webhook + enable sync) then reloads to reflect it.
        if (init?.provider === "gitlab") {
            try {
                await apiMutate(`/api/projects/${id}/gitlab-sync`, { method: "POST" })
            } catch {}
            window.location.reload()
            return
        }
        try {
            const data = await apiMutate<{ installed?: boolean; linked?: boolean }>(
                `/api/projects/${id}/github-sync/link`,
                { method: "POST" },
            )
            if (data?.installed && data?.linked) {
                window.location.reload()
                return
            }
        } catch {}
        const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG
        window.location.href = slug
            ? `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(id)}`
            : "https://github.com/apps"
    }

    async function build(effort: WizardEffort) {
        const res = await fetch(`/api/projects/${id}/analyser/index`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_type: "bootstrap", effort }),
        })
        if (!res.ok && res.status !== 202) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body?.error?.message || `Couldn't start indexing (${res.status})`)
        }
        // Indexing has started (status → 'indexing') so the layout gate lets us
        // in. Land on Knowledge to watch it build.
        router.push(`/projects/${id}/knowledge`)
    }

    if (!init) return <div className="mx-auto h-1 w-full max-w-xl animate-pulse rounded-full bg-[color:var(--c-border)]" />

    return (
        <SetupWizard
            projectName={init.name}
            provider={init.provider}
            installed={init.installed}
            initialDir={init.dir}
            initialAutoUpdate={init.autoUpdate}
            deleteHref={`/projects/${id}/settings`}
            onConnect={connect}
            onSaveGithub={saveGithub}
            onSaveAutoUpdate={saveAutoUpdate}
            onBuild={build}
        />
    )
}

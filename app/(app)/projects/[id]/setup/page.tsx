"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useApi } from "@/lib/client/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { SetupWizard, type WizardDir, type WizardEffort } from "@/components/projects/setup-wizard"
import type { GithubSyncDirection } from "@/lib/shared/types"

interface SetupProject {
    name: string
    provider: "github" | "gitlab" | null
    github_installation_id: number | null
    github_sync_enabled: boolean
    github_sync_direction: GithubSyncDirection
    auto_index_on_push: boolean
}

// First-run setup wizard page. Thin: loads the project's current state, then
// renders <SetupWizard> (all the UI + animation) wired to the real APIs. The
// same component is exercised standalone at /preview/setup-wizard.
//
// State comes from GET /api/projects/[id]. It used to be read straight from
// `projects` in the browser with the anon key, which returns nothing once 0067
// retired the tenant RLS policies — so github_installation_id read as null and
// `installed` was permanently false. That is what made the App step insist on
// installing a GitHub App that was already installed: Connect linked it
// successfully server-side, reloaded, re-read nothing, and offered to install
// again. GitHub, seeing its App already on the repo, could only offer
// "Configure", so the loop had no exit. Nothing to do with regions.
export default function SetupWizardPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    const { data, loading } = useApi<{ project: SetupProject | null }>(`/api/projects/${id}`)
    const [connectErr, setConnectErr] = useState<string | null>(null)

    const project = data?.project ?? null
    const provider = project?.provider === "gitlab" ? "gitlab" : "github"
    // GitLab sync is auto-provisioned at create (no App install), so
    // "connected" means sync is enabled; GitHub means the App is linked.
    // Null while loading — the wizard treats that as "not yet known" and blocks
    // advancing, rather than showing an install prompt it may have to retract.
    const installed = !project
        ? null
        : provider === "gitlab"
          ? !!project.github_sync_enabled
          : project.github_installation_id != null

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
        setConnectErr(null)
        // GitLab has no App install — "connect" re-runs provisioning (mint bot
        // token + register webhook + enable sync) then reloads to reflect it.
        if (provider === "gitlab") {
            try {
                await apiMutate(`/api/projects/${id}/gitlab-sync`, { method: "POST" })
            } catch (e) {
                setConnectErr(e instanceof ApiError ? (e.message ?? "Couldn't connect GitLab") : "Network error")
                return
            }
            window.location.reload()
            return
        }

        // Try to link an App that is ALREADY installed on the repo before
        // sending anyone to GitHub. Only an explicit installed:false earns the
        // redirect: bouncing on an ERROR is what made a failing link look like a
        // missing install, and GitHub answers that with "Configure" — a page
        // that cannot fix it and cannot complete the flow.
        try {
            const res = await apiMutate<{ installed?: boolean; linked?: boolean }>(
                `/api/projects/${id}/github-sync/link`,
                { method: "POST" },
            )
            if (res?.installed && res?.linked) {
                window.location.reload()
                return
            }
        } catch (e) {
            setConnectErr(
                e instanceof ApiError
                    ? `Couldn't connect the GitHub App: ${e.message ?? `failed (${e.status})`}`
                    : "Network error while connecting the GitHub App",
            )
            return
        }

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

    if (loading) return <div className="mx-auto h-1 w-full max-w-xl animate-pulse rounded-full bg-[color:var(--c-border)]" />

    return (
        <>
            {connectErr && (
                <div className="mx-auto mb-4 max-w-xl rounded-[10px] border border-rose-300 bg-rose-50/60 px-3 py-2 text-[12.5px] text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-400">
                    {connectErr}
                </div>
            )}
            <SetupWizard
                projectName={project?.name ?? ""}
                provider={provider}
                installed={installed}
                initialDir={project?.github_sync_enabled ? (project.github_sync_direction as WizardDir) : "both"}
                initialAutoUpdate={project?.auto_index_on_push ?? true}
                deleteHref={`/projects/${id}/settings`}
                onConnect={connect}
                onSaveGithub={saveGithub}
                onSaveAutoUpdate={saveAutoUpdate}
                onBuild={build}
            />
        </>
    )
}

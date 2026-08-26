"use client"
// Debug harness for the first-run setup wizard. Open /preview/setup-wizard to
// exercise <SetupWizard> in isolation — no auth, no project, no real API. The
// controls below fake the inputs; callbacks log to the console. Safe to delete.

import { useState } from "react"
import { SetupWizard } from "@/components/projects/setup-wizard"

type Installed = "unknown" | "no" | "yes"

export default function SetupWizardPreview() {
    const [installed, setInstalled] = useState<Installed>("no")
    const [failBuild, setFailBuild] = useState(false)
    const [nonce, setNonce] = useState(0) // bump to remount + reset wizard state

    const installedProp = installed === "unknown" ? null : installed === "yes"

    return (
        <div className="flex min-h-screen flex-col bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-4 py-2 text-[12px]">
                <span className="font-bold">Setup wizard · preview</span>
                <span className="text-[color:var(--c-text-dim)]">callbacks → console</span>

                <span className="ml-auto flex items-center gap-1.5">
                    <span className="text-[color:var(--c-text-muted)]">App:</span>
                    {(["unknown", "no", "yes"] as Installed[]).map((v) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setInstalled(v)}
                            className={`rounded-full px-2 py-0.5 font-semibold ${installed === v ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-white/60"}`}
                        >
                            {v}
                        </button>
                    ))}
                </span>

                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={failBuild} onChange={(e) => setFailBuild(e.target.checked)} />
                    build fails
                </label>

                <button
                    type="button"
                    onClick={() => setNonce((n) => n + 1)}
                    className="rounded-full bg-white px-2.5 py-0.5 font-semibold text-zinc-700 hover:bg-white/60"
                >
                    Reset
                </button>
            </div>

            <div className="flex flex-1 flex-col px-4">
                <SetupWizard
                    key={nonce}
                    projectName="my-repo"
                    installed={installedProp}
                    deleteHref="#"
                    onConnect={() => {
                        console.log("[wizard] connect")
                        setInstalled("yes")
                    }}
                    onSaveGithub={(dir) => console.log("[wizard] saveGithub", dir)}
                    onSaveAutoUpdate={(on) => console.log("[wizard] saveAutoUpdate", on)}
                    branchOptions={[
                        { name: "develop", protected: true },
                        { name: "release/2.0", protected: true },
                        { name: "feat/multi-branch", protected: false },
                        { name: "feat/new-thing", protected: false },
                    ]}
                    onSaveBranches={(b) => console.log("[wizard] saveBranches", b)}
                    onBuild={async (effort) => {
                        console.log("[wizard] build", effort)
                        await new Promise((r) => setTimeout(r, 900))
                        if (failBuild) throw new Error("Simulated: couldn't start indexing (503)")
                        console.log("[wizard] build → would redirect to /knowledge")
                    }}
                />
            </div>
        </div>
    )
}

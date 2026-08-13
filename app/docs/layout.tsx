import type { Metadata } from "next"
import { DocsShell } from "@/components/docs/docs-shell"

export const metadata: Metadata = {
    title: "Documentation — Ucelot by Bobby",
    description:
        "Learn how Ucelot builds codebase intelligence, how your data is processed, and how to manage issues.",
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
    return <DocsShell>{children}</DocsShell>
}

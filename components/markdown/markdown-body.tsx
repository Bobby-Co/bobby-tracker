"use client"

import type { ComponentProps } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ZooEmbed } from "@/components/embeds/zoo-embed"
import { IssueChip } from "@/components/issues/issue-chip"
import { EMBED_URI_SCHEME, parseEmbedRef } from "@/modules/embeds/domain/EmbedRef"
import { ISSUE_URI_SCHEME, parseIssueRef } from "@/modules/issues/domain/IssueRef"
import type { SignedEmbedMap } from "@/modules/embeds/domain/SignedEmbed"

// The one markdown renderer for issue bodies.
//
// It exists so that `zoo:` references have exactly one place they can be
// resolved — and, just as importantly, exactly one place they behave sanely
// when they can't be. A surface that renders bodies without signing (the
// timeline drawer) passes no map and gets a placeholder; it does not get a
// broken image, and it cannot accidentally request an unsigned URL, because a
// `zoo:` src is not something a browser can fetch.
//
// `embeds` is signed per render by the server. It is never persisted and never
// reused across page loads — see the module contract in modules/embeds.

/** react-markdown strips any URL whose protocol isn't on its allowlist, which
 *  includes ours: without this, `zoo:<id>` / `issue:<…>` arrive at the renderer
 *  as an empty string and the reference silently breaks. We widen the allowlist
 *  by exactly our two schemes and hand everything else to the default —
 *  `javascript:` and friends stay blocked, which is the reason the sanitizer is
 *  there in the first place. Both schemes are inert regardless: no browser can
 *  fetch or navigate them. */
function refAwareUrlTransform(url: string): string {
    return url.startsWith(EMBED_URI_SCHEME) || url.startsWith(ISSUE_URI_SCHEME) ? url : defaultUrlTransform(url)
}

export function MarkdownBody({
    children,
    embeds,
}: {
    children: string
    /** Signed embeds for this body, keyed by embed id. Omit on surfaces that
     *  don't sign — references then render as placeholders. */
    embeds?: SignedEmbedMap
}) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={refAwareUrlTransform}
            components={{
                img(props: ComponentProps<"img"> & { node?: unknown }) {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { node, src, alt, title, ...rest } = props
                    const embedId = parseEmbedRef(typeof src === "string" ? src : null)
                    if (embedId) {
                        return <ZooEmbed embed={embeds?.[embedId] ?? null} alt={alt ?? "Component preview"} title={title} />
                    }
                    // eslint-disable-next-line @next/next/no-img-element
                    return <img src={typeof src === "string" && src ? src : undefined} alt={alt ?? ""} title={title} {...rest} />
                },
                a(props: ComponentProps<"a"> & { node?: unknown }) {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { node, href, children, ...rest } = props
                    const issue = parseIssueRef(typeof href === "string" ? href : null)
                    if (issue) {
                        return (
                            <IssueChip projectId={issue.projectId} issueId={issue.issueId}>
                                {children}
                            </IssueChip>
                        )
                    }
                    return (
                        <a href={typeof href === "string" && href ? href : undefined} {...rest}>
                            {children}
                        </a>
                    )
                },
            }}
        >
            {children}
        </ReactMarkdown>
    )
}

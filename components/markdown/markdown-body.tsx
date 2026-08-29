"use client"

import type { ComponentProps } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ZooEmbed } from "@/components/embeds/zoo-embed"
import { EMBED_URI_SCHEME, parseEmbedRef } from "@/modules/embeds/domain/EmbedRef"
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
 *  includes ours: without this, `zoo:<id>` arrives at the `img` renderer as an
 *  empty string and every embed silently renders as a broken image. We widen the
 *  allowlist by exactly one scheme and hand everything else to the default —
 *  `javascript:` and friends stay blocked, which is the reason the sanitizer is
 *  there in the first place. `zoo:` is inert regardless: no browser can fetch it. */
function embedAwareUrlTransform(url: string): string {
    return url.startsWith(EMBED_URI_SCHEME) ? url : defaultUrlTransform(url)
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
            urlTransform={embedAwareUrlTransform}
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
            }}
        >
            {children}
        </ReactMarkdown>
    )
}

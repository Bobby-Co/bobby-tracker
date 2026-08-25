// Serve the email template gallery on http://localhost:4321.
//
// Why a server rather than just opening the file:
//   - the gallery renders each mail in an iframe, and browsers apply file://
//     origin rules to iframe content, which makes the dark-mode toggle (it
//     reaches into each frame's stylesheet) silently do nothing;
//   - the brand mark in every header is an absolute URL under
//     NEXT_PUBLIC_APP_URL, which is the DEPLOYED site — so previewing locally
//     would show a broken image for a mark that is perfectly fine in the real
//     mail. This serves the local file and rewrites those URLs to point at it.
//
// It also RE-RENDERS on every request, so editing a template and refreshing is
// the whole loop — no rebuild, no restart, nothing cached.
//
// node:http rather than Bun.serve: the same reason this file uses no other
// runtime-specific API — the repo's tsconfig doesn't carry Bun's globals, and a
// preview server isn't worth a dependency.
//
// Run with:
//   bun scripts/email-preview-serve.ts
// or, inside Claude Code, the "email-preview" entry in .claude/launch.json.

import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"

import { renderGallery } from "./email-preview"

const PORT = Number(process.env.EMAIL_PREVIEW_PORT ?? 4321)
const MARK_PATH = "/email/ucelot-mark.png"
const MARK_FILE = join(__dirname, "..", "public", MARK_PATH)

/** Point the mark at THIS server instead of the deployed site. The written
 *  .preview-emails/*.html files deliberately keep the absolute URL — those are
 *  meant to be byte-faithful to what gets sent. */
const localiseMark = (html: string) => html.split(new RegExp(`https?://[^"]*${MARK_PATH}`, "g")).join(MARK_PATH)

createServer((req, res) => {
    if (req.url?.startsWith(MARK_PATH)) {
        try {
            const png = readFileSync(MARK_FILE)
            res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" })
            res.end(png)
        } catch {
            // Not fatal: the gallery still renders, the header just shows the
            // blocked-image state — which is a state worth being able to see.
            res.writeHead(404).end("run: bun scripts/build-email-mark.ts")
        }
        return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    res.end(localiseMark(renderGallery()))
}).listen(PORT, () => console.log(`Email templates → http://localhost:${PORT}`))

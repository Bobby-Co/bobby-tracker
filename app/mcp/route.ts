// A second public URL for the same MCP server: https://<app>/mcp
//
// Identical behaviour to /api/mcp — same handlers, re-exported, no logic of its
// own. It exists because a client that keys a saved connector to its URL cannot
// be given a clean slate any other way: claude.ai recognises a re-added
// https://<app>/api/mcp and offers to "reconnect" the existing record, carrying
// forward whatever state made it fail. A different URL is a different server to
// it, so this is the only way to get a genuinely fresh connection without
// waiting for the far side to expire something we cannot see.
//
// It is also the friendlier URL to hand a human, and worth keeping for that
// alone once the diagnostic need has passed.

// Handlers are re-exported; the segment config is NOT. Next resolves route
// config statically at build time, so `dynamic` has to be declared literally in
// the file it applies to — re-exporting it fails the build outright.
export { GET, POST, OPTIONS } from "../api/mcp/route"

export const dynamic = "force-dynamic"

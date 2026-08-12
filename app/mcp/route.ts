// The MCP server's PUBLIC address: https://<app>/mcp
//
// Identical behaviour to /api/mcp — same handlers, re-exported, no logic of its
// own. This is the URL the Settings page hands out and the one to give a person.
//
// It exists because /api/mcp could not be connected from claude.ai. A client that
// keys a saved connector to its URL cannot be given a clean slate: re-adding
// https://<app>/api/mcp was recognised as the same server and offered a
// "reconnect" against the existing record, carrying forward whatever state made
// it fail — state living on the far side, where we can neither see nor clear it.
// A different URL is a different server to it, so this address is what finally
// produced a working connection.
//
// /api/mcp stays live and unchanged: it is the current transport, it works, and
// existing clients (Claude Code among them) are connected to it.

// Handlers are re-exported; the segment config is NOT. Next resolves route
// config statically at build time, so `dynamic` has to be declared literally in
// the file it applies to — re-exporting it fails the build outright.
export { GET, POST, OPTIONS } from "../api/mcp/route"

export const dynamic = "force-dynamic"

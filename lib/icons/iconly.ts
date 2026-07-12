// Iconly Bold-flavoured icon set used for labelling issue tags on
// the planning timeline. Inlined as SVG paths so the picker can
// scroll through the whole gallery without a network round-trip.
//
// Each entry is a 24×24 filled glyph. To extend the gallery, add a
// new entry below — IDs become the canonical name written to
// project_label_icons.icon_name.

export interface IconlyIcon {
    name: string
    keywords: string[]
    category: string
    paths: string[]
}

export const ICONLY_ICONS: IconlyIcon[] = [
    {
        name: "bug",
        category: "system",
        keywords: ["bug", "error", "issue", "defect"],
        paths: [
            "M12 2a4 4 0 0 0-3.87 3H8a3 3 0 0 0-3 3v1h14V8a3 3 0 0 0-3-3h-.13A4 4 0 0 0 12 2Z",
            "M5 11v3a7 7 0 0 0 14 0v-3H5Z",
            "M2 13a1 1 0 1 1 0-2h2v2H2Zm18 0v-2h2a1 1 0 1 1 0 2h-2ZM4 7.3 2.3 5.6a1 1 0 0 1 1.4-1.4L5.4 5.9 4 7.3Zm16 0L18.6 5.9l1.7-1.7a1 1 0 0 1 1.4 1.4L20 7.3ZM4 16.7l-1.7 1.7a1 1 0 0 0 1.4 1.4L5.4 18.1 4 16.7Zm16 0 1.4 1.4 1.7 1.7a1 1 0 0 1-1.4 1.4L18.6 18.1 20 16.7Z",
        ],
    },
    {
        name: "lightning",
        category: "system",
        keywords: ["fast", "speed", "perf", "performance", "lightning", "bolt"],
        paths: [
            "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
        ],
    },
    {
        name: "shield",
        category: "system",
        keywords: ["security", "auth", "shield", "protect"],
        paths: [
            "M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5l-8-3Z",
        ],
    },
    {
        name: "lock",
        category: "system",
        keywords: ["lock", "secure", "private", "auth"],
        paths: [
            "M7 10V8a5 5 0 1 1 10 0v2h.5A2.5 2.5 0 0 1 20 12.5v6A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10H7Zm2 0h6V8a3 3 0 1 0-6 0v2Z",
        ],
    },
    {
        name: "key",
        category: "system",
        keywords: ["key", "auth", "credential", "secret"],
        paths: [
            "M14 2a6 6 0 0 0-5.92 7L2 15.08V20h4v-2h2v-2h2v-2.08A6 6 0 1 0 14 2Zm2 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
        ],
    },
    {
        name: "user",
        category: "people",
        keywords: ["user", "person", "profile", "account"],
        paths: [
            "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
            "M3 21a9 9 0 0 1 18 0v1H3v-1Z",
        ],
    },
    {
        name: "users",
        category: "people",
        keywords: ["users", "team", "people", "group"],
        paths: [
            "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
            "M17 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
            "M2 21a7 7 0 0 1 14 0v1H2v-1Z",
            "M22 21v1h-5a8.97 8.97 0 0 0-1.16-4.43A4.99 4.99 0 0 1 22 21Z",
        ],
    },
    {
        name: "chat",
        category: "communication",
        keywords: ["chat", "message", "comment", "talk"],
        paths: [
            "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2Z",
        ],
    },
    {
        name: "mail",
        category: "communication",
        keywords: ["email", "mail", "inbox", "letter"],
        paths: [
            "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
            "M2 7l10 7L22 7",
        ],
    },
    {
        name: "bell",
        category: "communication",
        keywords: ["bell", "notification", "alert", "ping"],
        paths: [
            "M12 2a6 6 0 0 0-6 6v3l-2 4h16l-2-4V8a6 6 0 0 0-6-6Z",
            "M9 19a3 3 0 0 0 6 0H9Z",
        ],
    },
    {
        name: "home",
        category: "navigation",
        keywords: ["home", "house", "dashboard"],
        paths: [
            "M3 11 12 3l9 8v9a2 2 0 0 1-2 2h-3v-6h-8v6H5a2 2 0 0 1-2-2v-9Z",
        ],
    },
    {
        name: "folder",
        category: "files",
        keywords: ["folder", "directory", "files"],
        paths: [
            "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
        ],
    },
    {
        name: "document",
        category: "files",
        keywords: ["doc", "file", "document", "page"],
        paths: [
            "M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z",
            "M14 2v6h6",
        ],
    },
    {
        name: "code",
        category: "dev",
        keywords: ["code", "dev", "program", "develop"],
        paths: [
            "M9 7 4 12l5 5M15 7l5 5-5 5M13 4l-2 16",
        ],
    },
    {
        name: "terminal",
        category: "dev",
        keywords: ["terminal", "shell", "console", "cli"],
        paths: [
            "M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
            "M6 9l3 3-3 3M11 15h6",
        ],
    },
    {
        name: "database",
        category: "dev",
        keywords: ["database", "db", "data", "storage"],
        paths: [
            "M12 3c5 0 9 1.3 9 3v12c0 1.7-4 3-9 3s-9-1.3-9-3V6c0-1.7 4-3 9-3Z",
            "M3 6c0 1.7 4 3 9 3s9-1.3 9-3M3 12c0 1.7 4 3 9 3s9-1.3 9-3",
        ],
    },
    {
        name: "server",
        category: "dev",
        keywords: ["server", "backend", "infra", "host"],
        paths: [
            "M3 4h18v6H3zM3 14h18v6H3z",
            "M7 7h.01M7 17h.01",
        ],
    },
    {
        name: "cloud",
        category: "dev",
        keywords: ["cloud", "infra", "saas"],
        paths: [
            "M7 18a5 5 0 0 1 0-10 6 6 0 0 1 11.7 1A4 4 0 0 1 18 18H7Z",
        ],
    },
    {
        name: "globe",
        category: "dev",
        keywords: ["globe", "web", "internet", "world"],
        paths: [
            "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
            "M2 12h20M12 2c3 3.5 4.5 7.5 4.5 10S15 19.5 12 22M12 2C9 5.5 7.5 9.5 7.5 12S9 19.5 12 22",
        ],
    },
    {
        name: "search",
        category: "navigation",
        keywords: ["search", "find", "lookup"],
        paths: [
            "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z",
            "M16 16l5 5",
        ],
    },
    {
        name: "settings",
        category: "system",
        keywords: ["settings", "config", "gear", "options"],
        paths: [
            "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
            "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
        ],
    },
    {
        name: "wrench",
        category: "system",
        keywords: ["wrench", "tool", "fix", "repair"],
        paths: [
            "M21 4a5 5 0 0 0-7 6L4 20l2 2 10-10a5 5 0 0 0 6-7l-3 3-3-1-1-3 3-3Z",
        ],
    },
    {
        name: "rocket",
        category: "system",
        keywords: ["rocket", "launch", "release", "deploy"],
        paths: [
            "M12 2c4 0 7 3 7 7l-3 3-7-7 3-3ZM5 14l-3 6 6-3M9 19l-2-2",
            "M9 13l-4 4",
        ],
    },
    {
        name: "calendar",
        category: "system",
        keywords: ["calendar", "date", "schedule", "time"],
        paths: [
            "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
            "M3 10h18M8 2v4M16 2v4",
        ],
    },
    {
        name: "clock",
        category: "system",
        keywords: ["clock", "time", "schedule"],
        paths: [
            "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
            "M12 7v5l3 2",
        ],
    },
    {
        name: "star",
        category: "general",
        keywords: ["star", "favorite", "important"],
        paths: [
            "M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-7Z",
        ],
    },
    {
        name: "heart",
        category: "general",
        keywords: ["heart", "love", "favorite", "like"],
        paths: [
            "M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 5a5.5 5.5 0 0 1 9.5 7c-2.5 4.5-9.5 9-9.5 9Z",
        ],
    },
    {
        name: "flag",
        category: "general",
        keywords: ["flag", "milestone", "marker"],
        paths: [
            "M5 22V3h12l-2 4 2 4H7v11H5Z",
        ],
    },
    {
        name: "tag",
        category: "general",
        keywords: ["tag", "label", "category"],
        paths: [
            "M3 13V5a2 2 0 0 1 2-2h8l9 9-10 10L3 13Z",
            "M8 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
        ],
    },
    {
        name: "chart",
        category: "data",
        keywords: ["chart", "graph", "analytics", "metrics"],
        paths: [
            "M3 3v18h18",
            "M7 14l3-3 3 3 5-5",
        ],
    },
    {
        name: "image",
        category: "files",
        keywords: ["image", "photo", "picture"],
        paths: [
            "M3 5h18v14H3z",
            "M3 16l5-5 4 4 3-3 6 6",
            "M9 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
        ],
    },
    {
        name: "video",
        category: "files",
        keywords: ["video", "play", "movie"],
        paths: [
            "M3 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z",
            "M16 10l5-3v10l-5-3v-4Z",
        ],
    },
    {
        name: "edit",
        category: "actions",
        keywords: ["edit", "pencil", "write"],
        paths: [
            "M3 21l4-1 11-11-3-3L4 17l-1 4Z",
            "M14 4l3 3",
        ],
    },
    {
        name: "trash",
        category: "actions",
        keywords: ["delete", "trash", "remove"],
        paths: [
            "M5 6h14l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6Z",
            "M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 6h18",
        ],
    },
    {
        name: "check",
        category: "actions",
        keywords: ["check", "done", "complete", "tick"],
        paths: [
            "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
            "M7 12l3 3 7-7",
        ],
    },
    {
        name: "warning",
        category: "actions",
        keywords: ["warning", "alert", "caution"],
        paths: [
            "M12 2 1 21h22L12 2Z",
            "M12 9v5M12 17h.01",
        ],
    },
    {
        name: "info",
        category: "actions",
        keywords: ["info", "help", "about"],
        paths: [
            "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z",
            "M12 11v6M12 7h.01",
        ],
    },
    {
        name: "link",
        category: "actions",
        keywords: ["link", "url", "chain"],
        paths: [
            "M9 15a4 4 0 0 1 0-6l3-3a4 4 0 1 1 6 6l-2 2",
            "M15 9a4 4 0 0 1 0 6l-3 3a4 4 0 1 1-6-6l2-2",
        ],
    },
    {
        name: "package",
        category: "system",
        keywords: ["package", "box", "release", "ship"],
        paths: [
            "M3 7l9-4 9 4-9 4-9-4Z",
            "M3 7v10l9 4 9-4V7M12 11v10",
        ],
    },
    {
        name: "puzzle",
        category: "system",
        keywords: ["puzzle", "module", "plugin", "feature"],
        paths: [
            "M10 3a2 2 0 0 1 4 0v2h5v5a2 2 0 0 1 0 4v5h-5v-2a2 2 0 0 1-4 0v2H5v-5a2 2 0 0 1 0-4V5h5V3Z",
        ],
    },
]

export function findIcon(name: string | null | undefined): IconlyIcon | null {
    if (!name) return null
    return ICONLY_ICONS.find((i) => i.name === name) ?? null
}

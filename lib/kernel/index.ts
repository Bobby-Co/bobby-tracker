// Kernel barrel — the PURE surface only. Adapters (which import next/server)
// are intentionally excluded so that `import { ... } from "@/lib/kernel"` in
// domain/application code can never transitively pull in a runtime API. Import
// concrete adapters directly from "@/lib/kernel/adapters" at a composition root.

export * from "./result"
export * from "./events"
export * from "./ports"

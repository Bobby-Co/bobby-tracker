# Modules — architecture conventions

This directory is the target home for the backend's **bounded contexts**. We are
migrating the app from an anemic design (logic split between fat route handlers
and Postgres triggers, ~319 raw `.from()` calls, no domain layer) toward a
**modular, hexagonal DDD** shape via a strangler-fig migration — new work lands
here; old code is moved in module by module, keeping the app shippable at every
step.

Two non-negotiable goals shape every rule below:

1. **Runtime portability** — the app must run beyond Workers-alone (a Node /
   container deploy for scale) without rewrites.
2. **Service extractability** — any module must be promotable to its own API
   service later as a transport swap, not a rewrite.

Both are bought with the same discipline: a runtime-agnostic core behind ports.

---

## The hexagon: layers inside a module

```
modules/<context>/
  domain/          entities · value objects · policies · domain events
                   PURE. No I/O, no framework, no SDK. Unit-testable alone.
  application/     use-cases — orchestrate domain + ports; emit events.
                   Depends ONLY on domain + kernel ports. Returns Result<T>.
  ports/           the interfaces THIS module needs (repositories, external
                   clients, channels). Declared here, implemented in infrastructure.
  infrastructure/  adapters — the concrete world (Supabase repos, GitHub/JMAP
                   clients, channels). The ONLY place that imports an SDK/runtime.
  interface/       inbound adapters — HTTP handlers, event subscribers, queue
                   consumers. Thin: parse → validate → authorize → delegate.
  index.ts         the module's PUBLIC CONTRACT — its commands/queries + the
                   events it emits. Other modules import ONLY this.
```

Dependency rule (points inward): `interface → application → domain`;
`infrastructure` implements `ports`; `domain` depends on nothing but itself and
the kernel's pure types.

## The shared kernel — `lib/kernel/`

Deliberately thin. Fat kernels re-couple the modules you just separated.

| Export | What it is |
| --- | --- |
| `Result<T>`, `ok`, `err`, `DomainError` | typed outcomes; errors are values, not thrown control-flow |
| `DomainEvent`, `EventBus`, `InProcessEventBus` | the pub/sub seam; in-process now, broker adapter later |
| `Clock`, `BackgroundTasks`, `IdGenerator` (ports) | runtime services the core depends on abstractly |
| `adapters.ts` | the concrete Workers implementations (`systemClock`, `workersBackgroundTasks`, `cryptoIdGenerator`) — imported only at a composition root |

`@/lib/kernel` re-exports the **pure** surface only; import adapters explicitly
from `@/lib/kernel/adapters`.

## Composition root

One small file per host wires modules with concrete adapters and injects them.
Today the host is the Next/Workers app. A future `node-server` or
`queue-consumer` entry swaps only this file — the modules compile unchanged.

---

## SOLID, applied

- **DIP** — depend on abstractions. The core declares ports; adapters implement
  them; the composition root wires them. Nothing in `domain`/`application` knows
  what a Supabase, a Worker, or a JMAP server is.
- **OCP** — add a channel, event kind, repo backend, or host by *registering* a
  new adapter, never by editing the dispatcher/emitter/existing adapters.
- **LSP** — every implementation of a port honours one behavioural contract
  (same pre/postconditions, same error semantics). E.g. a channel's `deliver()`
  is idempotent and *resolves* (never throws) on opt-out; a repo `find` returns
  null, never throws. The core uses any adapter blind and stays correct.

## Six rules that keep a module extractable

1. **Own your data.** A module's tables (ideally its own schema) are private. No
   other module queries them directly — the #1 blocker in the current single
   `tracker` schema.
2. **Talk only through published contracts** (`index.ts`) — commands/queries +
   events. Never import another module's internals or query its tables.
3. **Prefer events over direct calls** for cross-module reactions. In-process
   dispatcher now, broker later; the producer never knows which.
4. **Stateless application layer.** No module-global mutable state; per-request
   context is passed in.
5. **Idempotent handlers + outbox.** At-least-once delivery means a message can
   arrive twice; dedupe on a stable key.
6. **No framework/runtime types cross the port line.** `domain`/`application`
   import only the kernel and their own module — never `next/*`, Workers
   globals, or a DB SDK. Enforced by the eslint boundary rule in
   `eslint.config.mjs`.

---

## Migration phases (strangler-fig)

- **Phase 0 — seams & guardrails** *(in progress)*: kernel ports, this doc, the
  DIP eslint rule, a `typecheck` script; close the issues-route authz gap; fix
  the `void`-promise post-response writes.
- **Phase 1 — repository ports & data ownership**: move `.from()` behind repos;
  assign each table to an owning module; stop cross-module queries.
- **Phase 2 — Notifications, the first full hexagon**: typed `NotificationEvent`
  registry, dispatcher, `Channel` port + adapters (in-app, email; web-push
  later), outbox, team-aware recipient resolution. The reference implementation.
- **Phase 3 — carve the domain modules**: Issues, Pull Requests, GitHub Sync,
  Analysis behind their use-cases; split the god modules; move rendering out of
  the sync files.
- **Phase 4 — consolidate**: unify the client mutation layer + response
  envelope; add a Node composition root as a CI portability smoke-test.
- **Horizon** — extract a module as its own service when it earns it (Analysis /
  GitHub Sync / Notifications first). With the six rules held, it's a transport
  swap, not a rewrite.

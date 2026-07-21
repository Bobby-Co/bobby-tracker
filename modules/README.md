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
  Composition.ts   the wiring seam: small factories/resolvers that construct
                   concrete classes and hand back the PORT type (see rule 4 below).
  index.ts         the module's PUBLIC CONTRACT — its commands/queries + the
                   events it emits. Other modules import ONLY this.
```

The **inbound interface layer** (HTTP handlers) is the Next host's `app/api/**`
routes, not a folder inside the module — thin controllers that parse → validate →
authorize → delegate to a service/repository obtained from the module's contract.

Dependency rule (points inward): `route → application → domain`; `infrastructure`
implements `ports`; `domain` depends on nothing but itself and the kernel's pure
types.

## Objects, not bags of functions — the OOP contract

This is an OOP codebase. The rules below are non-negotiable; a reviewer should
reject a PR that breaks them.

1. **A port is an `interface`. Every implementation is a `class … implements
   Port`.** Never a factory that returns an object literal
   (`export function createFoo(): Port { return { … } }` is banned — that's the
   anti-pattern that keeps sneaking back in). The class name is the concrete noun
   (`GithubVcsAppInstance`, `SupabaseIssuesRepository`, `EmailChannel`); the
   interface is the role (`VcsAppInstance`, `IssuesRepository`,
   `NotificationChannel`). See **naming conventions** below.
2. **Dependencies are constructor-injected** and held as `private readonly`
   fields — the DB client, other ports, config. No hidden module singletons, no
   reaching for a global.
3. **Domain aggregates and application services are classes too** (`Issue`,
   `Project`, `VcsAppService`, `PullRequestService`, `NotificationDispatcher`).
   Domain aggregates use a private constructor + a static factory (`Issue.of(…)`)
   so an instance can't be built in an invalid state.
4. **Callers depend on the port type, and obtain a concrete instance from a
   composition seam — they do NOT `new` an adapter directly.** The seam is a
   small factory/resolver that returns the *interface* (`createSupabaseIssuesRepository(db): IssuesRepository`,
   `resolveVcsAppInstance(project): VcsAppInstance | null`, `getVcsAppService(…)`),
   or a per-host composition root. These factories are the ONLY place a concrete
   class name appears at a call site; that's what keeps the DIP boundary intact
   and makes swapping an adapter (GitHub → GitLab, Supabase → another store) a
   one-line change in the seam rather than a sweep across the app. A `create*`
   factory whose body is `return new ConcreteClass(deps)` is correct and expected
   — it is a composition seam, not the banned object-literal factory from rule 1.

Plain module-level **functions are still fine** for pure helpers and transport
primitives that are NOT a port implementation (DTO mappers, a `syncHash`, the
private REST/crypto helpers inside an adapter). The rule targets *port
implementations*, not every function.

## The reference module: `vcs` (the golden standard)

`modules/vcs` is the worked example — **copy its shape** when carving a new module
or refactoring an old one. It is the provider-agnostic VCS aggregate (GitHub
today; GitLab/Bitbucket are a future adapter set), and it exercises every rule
above end-to-end.

```
modules/vcs/
  domain/                        pure, client-safe, no I/O
    PullRequest.ts               aggregate (lifecycle rules) + .test.ts
    MergeGate.ts                 merge policy (PR × review → gate)
    RepoRef.ts · SyncHash.ts     value objects / pure primitives
  ports/                         the interfaces the module depends on
    VcsAppInstance.ts            role: remote ops as the installed app/bot
    VcsUserInstance.ts           role: remote ops as the signed-in user
    WebhookVerifier.ts           role: verify an inbound webhook signature
    PullRequestStore.ts          role: persist the PR mirror
    VcsTypes.ts                  the vendor-neutral DTOs the ports speak
  application/                   orchestration; imports only domain + ports
    VcsAppService.ts             issue-sync use cases + bot-comment primitives
    VcsUserService.ts            user-authored comment use cases
    PullRequestService.ts        PR mirror / backfill
  infrastructure/                the ONLY SDK/vendor code
    GithubVcsAppInstance.ts      implements VcsAppInstance (+ GithubAppClient transport)
    GithubVcsUserInstance.ts     implements VcsUserInstance
    GithubWebhookVerifier.ts     implements WebhookVerifier
    SupabasePullRequestStore.ts  implements PullRequestStore
    GithubTokenRepository.ts     port + Supabase adapter for the user's token
    CommentActions.ts            the comment-authoring gate
  Composition.ts                 resolvers/factories that return PORT types
  index.ts                       the public contract (barrel)
```

Read it as **role → provider swap.** A caller holds a `VcsAppInstance`; the ONE
place that knows it is GitHub is `Composition.ts`
(`resolveVcsAppInstance(project)` → `new GithubVcsAppInstance(...)`). Adding a
second provider is a new `GitlabVcsAppInstance` + one branch in `Composition.ts`
— nothing else changes. That is the payoff of the whole discipline, made concrete.

Moves it demonstrates, worth imitating:

- **Split a port by identity, not convenience.** App-authority (`VcsAppInstance`,
  installation token) and user-authority (`VcsUserInstance`, personal token) are
  different principals → two interfaces, not one with a mode flag.
- **The adapter owns ALL vendor detail.** `GithubVcsAppInstance` holds the REST/
  GraphQL calls, the token transport (`GithubAppClient`), and the GitHub↔neutral
  mapping as private methods. There are no loose `github-*.ts` function modules
  leaking a vendor vocabulary across the app.
- **A cross-cutting flow lives with its owner, reached through a port.** The
  analysis flow lives in `modules/analysis` and posts comments via
  `VcsAppService.postComment(...)`; it never learns a token or an owner/repo.

### The same shape in every module

The discipline isn't `vcs`-only — every module names a role, hides the vendor/IO
behind an adapter, and owns its behaviour in a class. A floating grab-bag of
functions is the anti-pattern; each of these replaced one:

| Module | Role (port) | Adapter (owns the IO) | Owned behaviour |
|---|---|---|---|
| `analysis` | `Analyser`, `PullRequestAnalysisStore` | `HttpAnalyser` (all bobby-analyser transport), `SupabasePullRequestAnalysisStore` | `IssueAnalysisService`, `PullRequestAnalysisService` |
| `issues` | `IssuesRepository`, `EmbeddingIndex`, `IssueSyncStore` | `SupabaseIssuesRepository`, `SupabaseEmbeddingIndex` | `IssueEmbedder`, the `Issue` aggregate |
| `public` | `PublicSessionRepository` | `SupabasePublicSessionRepository` | `PublicSessionService` gate + the `PublicSession` aggregate |
| `teams` | `InviteNotifier`, `TeamMembershipRepository` | `JmapInviteNotifier`, `SupabaseTeamMembershipRepository` | `domain/Invite` value helpers |
| `notifications` | `NotificationChannel`, `RecipientResolver`, `OutboxStore` | `EmailChannel`, `InAppFeedChannel`, `Supabase*` | `NotificationService.drain()`, `NotificationDispatcher` |
| `relay` | `AnalyserWorkerDirectory` | `HttpAnalyserWorkerDirectory` | `domain/PairingCodes` value helpers |
| `projects` | `ProjectsRepository` | `SupabaseProjectsRepository` | the `Project` aggregate + `pickStatus` policy |

Pure value/domain helpers (`RepoRef`, `SyncHash`, `PairingCodes`, `Invite`,
`pickStatus`) stay as functions in a well-named concept file — a class there would
be ceremony. The test is ownership, not "is it a class."

## Naming conventions (Java / adjective-trait style)

- **Interface = the role/capability** — a noun or adjective: `VcsAppInstance`,
  `WebhookVerifier`, `PullRequestStore`, `IssuesRepository`, `Analyser`. No `I`
  prefix, no `Port` suffix.
- **Implementation = specific type carrying the full role name**, prefixed by its
  technology/provider: `GithubVcsAppInstance implements VcsAppInstance`,
  `SupabasePullRequestStore implements PullRequestStore`,
  `GithubWebhookVerifier implements WebhookVerifier`. **Never an `Impl` suffix** —
  it dead-ends the moment a second implementation (a mock, a second provider)
  appears.
- **Acronyms are words** (Google/Java casing): `Vcs`, `Github`, `Http`, `Pr`,
  `Url`, `Id` — not `VCS`, `HTTP`. Hence `VcsAppInstance`, not `VCSAppInstance`.
- **Concrete classes with no interface** keep a plain descriptive name
  (`VcsAppService`, `PullRequestService`, `GithubAppClient`, `NotificationDispatcher`).
- **Files are PascalCase, named after the primary type** they export, one type per
  file (`GithubVcsAppInstance.ts`, `VcsAppInstance.ts`); `index.ts`, `Composition.ts`
  are the fixed exceptions. *Status:* **all seven hexagon modules now follow this
  convention** — PascalCase files and the Java identifier rules throughout. `vcs`
  is the reference; the others mirror it. New modules start here.

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

## What lives in `lib/` vs `modules/`

`lib/` is **not** a junk drawer. It holds only the shared technical foundation
that any module may depend on — never a bounded context's domain logic. There is
exactly one rule and it decides where any file goes:

> **A file belongs in `modules/<context>/` if it encodes what the product *does*
> (a capability: issues, pull-requests, github sync, analysis, notifications).
> It belongs in `lib/` only if it is context-free plumbing that every capability
> could reuse.**

`lib/` therefore contains just these categories:

| Folder | What it is | Example |
| --- | --- | --- |
| `lib/kernel/` | the pure runtime-agnostic core (above) | `Result`, `EventBus` |
| `lib/platform/` | shared **infrastructure** adapters — the concrete runtime any module talks to | `platform/http/api.ts` (route envelope + `requireAccess`), `platform/http/api-client.ts`, `platform/email/jmap.ts` (JMAP transport), `platform/rate-limit.ts`, `supabase/` (DB client + generated types) |
| `lib/rendering/` | shared **presentation** helpers consumed by more than one context and by the client | `badge.ts` (finding/score/verdict visual vocabulary) |
| `lib/util/` | pure, product-agnostic helpers | `image-compress`, `realtime-channels`, `repo-url` |

Everything else — anything that names an issue, a PR, a comment, an analysis, a
notification — lives in `modules/`. When a pure domain policy needs a DB row's
shape, it declares a **local value-object** for the fields it reads (e.g.
`MergePull`/`MergeReview` in pull-requests, `ProjectInsightView` in projects)
rather than importing `@/lib/supabase/types`, so it stays lint-clean under the
DIP boundary and carries no SDK dependency.

**Migration status (2026-07): `lib/` root is fully drained** — no loose files,
only the category folders above. Contexts now consolidated in `modules/`: **`vcs`**
(the former `github` + `pull-requests`, merged — a PR can't exist without a VCS;
this is the **golden-standard** module above), `analysis` (owns the issue/PR
analysis flows), `issues`, `projects`, `notifications`, `teams`, `public`,
`relay`. **Deliberately kept in `lib/`**: `lib/auth/` (team-access +
access are cross-cutting authz used by every route — a supporting subdomain, not
one context; its `*-context.tsx` React providers are frontend and could move to
`components/`). `lib/icons/`, `lib/hooks/`, and the presentation half of
`lib/timeline/` are frontend, not backend contexts, and are out of scope for the
modules split.

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
  later), outbox, team-aware recipient resolution.
- **Phase 3 — carve the domain modules**: Issues, Projects, Analysis, and the
  provider-agnostic **`vcs`** aggregate (GitHub sync + pull requests) behind their
  ports/use-cases; split the god modules; move rendering out of the sync files.
  `vcs` is the reference result — see **“The reference module”** above.
- **Phase 4 — consolidate**: unify the client mutation layer + response
  envelope; add a Node composition root as a CI portability smoke-test.
- **Horizon** — extract a module as its own service when it earns it (Analysis /
  GitHub Sync / Notifications first). With the six rules held, it's a transport
  swap, not a rewrite.

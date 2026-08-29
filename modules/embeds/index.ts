// Embeds — the public contract.
//
// What this module does: our app decides whether a viewer may see an issue,
// then VOUCHES for that decision to Zoo by signing the image URL with our
// Ed25519 private key (upstream contract §2). Zoo holds only the public key.
//
// Two rules the rest of the app has to keep, because nothing here can enforce
// them from the inside:
//
//   1. Call the signing service only AFTER your own access check has passed.
//   2. Persist the embed id (`zoo:<id>` in a body). Never persist a signed URL
//      — it is a bearer token until it expires (contract §9).
//
// Server-only surface. Client components import the pure types and the `zoo:`
// scheme from `@/modules/embeds/domain/*` directly.

export { ComponentPickerService } from "./application/ComponentPickerService"
export type { PickResult } from "./application/ComponentPickerService"
export { EmbedSigningService } from "./application/EmbedSigningService"
export { getComponentPickerService, getEmbedSigningService, resolveEmbedUrlSigner } from "./Composition"

export { EmbedId } from "./domain/EmbedId"
export { EMBED_EXP_BUCKET_SECONDS, EMBED_MAX_TTL_SECONDS, embedExpiry } from "./domain/EmbedExpiry"
export { EMBED_SIGNATURE_VERSION, embedSigningPayload, isValidKid } from "./domain/EmbedSignature"
export { embedMarkdown, insertEmbedReference } from "./domain/EmbedInsertion"
export type { EmbedInsertion } from "./domain/EmbedInsertion"
export { EMBED_URI_SCHEME, MAX_EMBEDS_PER_BODY, collectEmbedIds, embedRef, parseEmbedRef, parsePastedEmbedId } from "./domain/EmbedRef"
export type { EmbedAvailability, SignedEmbed, SignedEmbedMap } from "./domain/SignedEmbed"
export type { ComponentCatalog, ComponentThumbnails, ThumbnailResult } from "./ports/ComponentCatalog"
export type { EmbedMinter, MintFailure, MintResult } from "./ports/EmbedMinter"
export type { ZooCatalogue, ZooComponent } from "./domain/ZooComponent"
export { normalizeRepoUrl } from "./domain/RepoKey"
export type { EmbedFormat, EmbedUrlSigner } from "./ports/EmbedUrlSigner"
export type { EmbedDescription, EmbedMetadata, EmbedMetadataSource } from "./ports/EmbedMetadataSource"

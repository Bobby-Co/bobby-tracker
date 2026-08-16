// Regions module — composition root. The one place that knows the registry is
// env-backed today. Swapping it for a KV- or DB-backed directory (when regions
// gain their own Supabase and the mapping stops being static) means replacing
// this file; callers depend on the RegionRegistry port and never construct the
// adapter.

import type { RegionRegistry } from "./ports/RegionRegistry"
import { EnvRegionRegistry } from "./infrastructure/EnvRegionRegistry"

/** The app-wide region registry. Stateless — constructing per call keeps env
 *  reads live, which is what makes config changes visible without a redeploy. */
export function getRegionRegistry(): RegionRegistry {
    return new EnvRegionRegistry()
}

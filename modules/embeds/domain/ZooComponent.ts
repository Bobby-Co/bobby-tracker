// A component Zoo can render, as the picker shows it.
//
// This is NOT an embed. A component is live — it changes when its source does.
// An embed is a frozen render of one, minted on demand. The picker lists these
// and mints on selection, which is why choosing one costs a round trip.

export interface ZooComponent {
    id: string
    name: string
    description: string
    /** Source path, shown to disambiguate two components with the same name. */
    file: string
}

/** What the catalogue knows about a project, beyond its components.
 *  `online` matters to the picker: the catalogue answers from Zoo's cache with
 *  the developer's daemon shut, but MINTING needs it live, so a component list
 *  can be browsable and unmintable at the same time — and the picker has to say
 *  so before someone clicks. */
export interface ZooCatalogue {
    repo: string
    project: string
    online: boolean
    components: ZooComponent[]
}

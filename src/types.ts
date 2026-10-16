export type Asset = { id: string; mime: string; original_name: string; position: number; size: number };
export type Item = { id: string; title: string; url: string; note: string; category: string; tags: string[]; created: string; kind: string; import_status: string; import_message: string; assets: Asset[]; projectIds: string[]; boardIds: string[] };
export type Element = { id: string; item_id: string | null; text: string; x: number; y: number; width: number; height: number; z: number; color: string };
export type Board = { id: string; title: string; description: string; created: string; revision: number; elements: Element[]; projectIds: string[] };
export type Project = { id: string; title: string; description: string; notes: string; created: string; itemIds: string[]; boardIds: string[] };
export type State = { items: Item[]; boards: Board[]; projects: Project[] };

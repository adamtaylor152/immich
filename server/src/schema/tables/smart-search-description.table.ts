import { Column, ForeignKeyColumn, Index, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';

// Sibling of smart_search that stores a CLIP-text embedding of an asset's
// description (manual or VLM-generated). Lets smart search retrieve via
// "what the description says about the image" alongside the visual embedding,
// recovering CLIP queries that miss because the visual encoder didn't capture
// the relevant concept but the description (or VLM) did.
@Table({ name: 'smart_search_description' })
@Index({
  name: 'clip_description_index',
  using: 'hnsw',
  expression: `embedding vector_cosine_ops`,
  with: `ef_construction = 300, m = 16`,
  synchronize: false,
})
export class SmartSearchDescriptionTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', primary: true })
  assetId!: string;

  @Column({ type: 'vector', length: 768, storage: 'external', synchronize: false })
  embedding!: string;
}

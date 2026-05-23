import { ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';
import { SmartAlbumTable } from 'src/schema/tables/smart-album.table';

@Table({ name: 'smart_album_exclusion' })
export class SmartAlbumExclusionTable {
  @ForeignKeyColumn(() => SmartAlbumTable, { onDelete: 'CASCADE', nullable: false, primary: true })
  smartAlbumId!: string;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', nullable: false, primary: true })
  assetId!: string;
}

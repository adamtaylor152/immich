import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';
import { SmartAlbumTable } from 'src/schema/tables/smart-album.table';

@Table({ name: 'smart_album_asset' })
export class SmartAlbumAssetTable {
  @ForeignKeyColumn(() => SmartAlbumTable, { onDelete: 'CASCADE', nullable: false, primary: true })
  smartAlbumId!: string;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', nullable: false, primary: true, index: true })
  assetId!: string;

  @CreateDateColumn()
  addedAt!: Generated<Timestamp>;

  @Column({ type: 'text' })
  matchReason!: string;
}

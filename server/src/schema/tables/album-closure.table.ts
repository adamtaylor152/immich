import { ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AlbumTable } from 'src/schema/tables/album.table';

@Table('album_closure')
export class AlbumClosureTable {
  @ForeignKeyColumn(() => AlbumTable, { primary: true, onDelete: 'CASCADE', onUpdate: 'NO ACTION', index: true })
  id_ancestor!: string;

  @ForeignKeyColumn(() => AlbumTable, { primary: true, onDelete: 'CASCADE', onUpdate: 'NO ACTION', index: true })
  id_descendant!: string;
}

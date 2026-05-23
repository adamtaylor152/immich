import { Column, CreateDateColumn, ForeignKeyColumn, Generated, PrimaryGeneratedColumn, Table, Timestamp } from '@immich/sql-tools';
import { AlbumTable } from 'src/schema/tables/album.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table({ name: 'smart_album' })
export class SmartAlbumTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @Column({ type: 'text' })
  kind!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', nullable: false })
  ownerId!: string;

  @ForeignKeyColumn(() => AlbumTable, { onDelete: 'CASCADE', nullable: false })
  albumId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

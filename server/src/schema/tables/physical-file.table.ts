import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  Int8,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { PhysicalFileType } from 'src/enum';
import { AssetTable } from 'src/schema/tables/asset.table';

@Table('physical_file')
@Unique({ columns: ['path'] })
@Index({ columns: ['canonicalAssetId', 'type'] })
@Index({ columns: ['checksum', 'sizeInBytes', 'type'] })
@UpdatedAtTrigger('physical_file_updatedAt')
export class PhysicalFileTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @Column()
  type!: PhysicalFileType;

  @Column({ type: 'bytea' })
  checksum!: Buffer;

  @Column({ type: 'bigint' })
  sizeInBytes!: Int8;

  @Column()
  path!: string;

  @ForeignKeyColumn(() => AssetTable, { nullable: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  canonicalAssetId!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}

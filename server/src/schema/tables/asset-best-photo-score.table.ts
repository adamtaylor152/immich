import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';
import { UserTable } from 'src/schema/tables/user.table';

@Index({ columns: ['ownerId', 'score'] })
@Index({ columns: ['scoreVersion', 'computedAt'] })
@Index({ columns: ['computedAt'] })
@Table('asset_best_photo_score')
export class AssetBestPhotoScoreTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  assetId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  ownerId!: string;

  @Column({ type: 'double precision' })
  score!: number;

  @Column({ type: 'double precision', nullable: true })
  aestheticScore!: number | null;

  @Column({ type: 'double precision', nullable: true })
  technicalScore!: number | null;

  @Column({ type: 'double precision', nullable: true })
  subjectScore!: number | null;

  @Column({ type: 'double precision', nullable: true })
  diversityScore!: number | null;

  @Column({ type: 'integer' })
  scoreVersion!: number;

  @Column({ type: 'timestamp with time zone' })
  computedAt!: Timestamp;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'integer', nullable: true })
  bestFrameTimestampMs!: number | null;

  @Column({ type: 'double precision', nullable: true })
  frameScore!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  frameMetadata!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}

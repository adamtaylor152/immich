import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger } from 'src/decorators';
import { MediaHealthCategory, MediaHealthSeverity, MediaHealthStatus } from 'src/enum';
import { AssetTable } from 'src/schema/tables/asset.table';

@Table('asset_health_run')
export class AssetHealthRunTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @Column()
  category!: MediaHealthCategory;

  @Column({ default: 'running' })
  status!: Generated<string>;

  @CreateDateColumn()
  startedAt!: Generated<Timestamp>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  finishedAt!: Timestamp | null;

  @Column({ type: 'integer', default: 0 })
  totalAssets!: Generated<number>;

  @Column({ type: 'integer', default: 0 })
  checkedAssets!: Generated<number>;

  @Column({ type: 'integer', default: 0 })
  foundAssets!: Generated<number>;

  @Column({ type: 'text', nullable: true })
  error!: string | null;
}

@Index({ columns: ['category', 'status'] })
@Index({ columns: ['checkedAt'] })
@Unique({ columns: ['assetId', 'category'] })
@UpdatedAtTrigger('asset_health_updatedAt')
@Table('asset_health')
export class AssetHealthTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  assetId!: string;

  @ForeignKeyColumn(() => AssetHealthRunTable, { nullable: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  runId!: string | null;

  @Column()
  category!: MediaHealthCategory;

  @Column()
  status!: MediaHealthStatus;

  @Column()
  severity!: MediaHealthSeverity;

  @Column()
  originalPath!: string;

  @Column()
  originalFileName!: string;

  @Column({ type: 'jsonb' })
  evidence!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  resolution!: Record<string, unknown>;

  @Column({ type: 'timestamp with time zone' })
  checkedAt!: Timestamp;

  @Column({ type: 'timestamp with time zone', nullable: true })
  dismissedAt!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  resolvedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}

@Index({ columns: ['healthId'] })
@Unique({ columns: ['healthId', 'candidatePath'] })
@UpdatedAtTrigger('asset_health_candidate_updatedAt')
@Table('asset_health_candidate')
export class AssetHealthCandidateTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AssetHealthTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  healthId!: string;

  @Column()
  candidatePath!: string;

  @Column()
  status!: MediaHealthStatus;

  @Column({ type: 'double precision', nullable: true })
  visualMatchScore!: number | null;

  @Column({ type: 'jsonb' })
  evidence!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  resolution!: Record<string, unknown>;

  @Column({ type: 'timestamp with time zone' })
  checkedAt!: Timestamp;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}

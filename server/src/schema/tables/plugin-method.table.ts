import { Column, ForeignKeyColumn, Generated, PrimaryGeneratedColumn, Table, Unique } from '@immich/sql-tools';
import { JsonSchemaDto } from 'src/dtos/json-schema.dto';
import { WorkflowType } from 'src/enum';
import { PluginTable } from 'src/schema/tables/plugin.table';

@Unique({ columns: ['pluginId', 'name'] })
@Table('plugin_method')
export class PluginMethodTable {
  @PrimaryGeneratedColumn('uuid')
  id!: Generated<string>;

  @ForeignKeyColumn(() => PluginTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  pluginId!: string;

  @Column()
  name!: string;

  @Column()
  title!: string;

  @Column()
  description!: string;

  @Column({ type: 'character varying', array: true })
  types!: Generated<WorkflowType[]>;

  @Column({ type: 'boolean', default: false })
  hostFunctions!: Generated<boolean>;

  // Fork-native databases stay at the post-update workflow schema stage and do not
  // have this column; plugin.repository detects it at runtime. synchronize: false
  // keeps it out of schema-drift comparison while preserving the Kysely types.
  @Column({ type: 'character varying', default: [], array: true, synchronize: false })
  allowedHosts!: Generated<string[]>;

  @Column({ type: 'jsonb', nullable: true })
  schema!: JsonSchemaDto | null;

  @Column({ type: 'character varying', default: [], array: true })
  uiHints!: Generated<string[]>;
}

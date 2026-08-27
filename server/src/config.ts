// Compatibility shim: upstream moved the SystemConfig type, defaults, and the
// config zod schema into src/dtos/config.dto.ts. Fork code historically
// imported these from 'src/config'; keep that import path working so the
// fork's many consumers (services, repositories, tests) don't all have to
// change at once.
export { defaults, type MachineLearningConfig, type SystemConfig } from 'src/dtos/config.dto';

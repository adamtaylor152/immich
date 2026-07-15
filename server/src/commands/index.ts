import { ConfirmForkSchemaStartQuestion, forkSchemaCommands } from 'src/commands/fork-schema.command';
import { GrantAdminCommand, PromptEmailQuestion, RevokeAdminCommand } from 'src/commands/grant-admin';
import { ListUsersCommand } from 'src/commands/list-users.command';
import { DisableMaintenanceModeCommand, EnableMaintenanceModeCommand } from 'src/commands/maintenance-mode';
import {
  ChangeMediaLocationCommand,
  PromptConfirmMoveQuestions,
  PromptMediaLocationQuestions,
} from 'src/commands/media-location.command';
import { DisableOAuthLogin, EnableOAuthLogin } from 'src/commands/oauth-login';
import { DisablePasswordLoginCommand, EnablePasswordLoginCommand } from 'src/commands/password-login';
import { PromptPasswordQuestions, ResetAdminPasswordCommand } from 'src/commands/reset-admin-password.command';
import { SchemaCheck } from 'src/commands/schema-check';
import { VersionCommand } from 'src/commands/version.command';

// NOTE: `schema-revert-to-upstream` was REMOVED in this fork. The CLI command
// was broken — several fork migrations had empty `down()` stubs that silently
// reported success while leaving fork tables intact, so the downstream upstream
// image would crash on missing tables. Users wishing to downgrade should now
// restore from a `pg_dump` backup taken before installing the fork.

export const commandsAndQuestions = [
  ...forkSchemaCommands,
  ConfirmForkSchemaStartQuestion,
  ResetAdminPasswordCommand,
  PromptPasswordQuestions,
  PromptEmailQuestion,
  EnablePasswordLoginCommand,
  DisablePasswordLoginCommand,
  EnableMaintenanceModeCommand,
  DisableMaintenanceModeCommand,
  EnableOAuthLogin,
  DisableOAuthLogin,
  ListUsersCommand,
  VersionCommand,
  GrantAdminCommand,
  RevokeAdminCommand,
  ChangeMediaLocationCommand,
  PromptMediaLocationQuestions,
  PromptConfirmMoveQuestions,
  SchemaCheck,
];

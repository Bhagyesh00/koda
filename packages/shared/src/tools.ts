import { z } from 'zod';

export const ReadFileArgs = z.object({
  path: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

export const WriteFileArgs = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const EditFileArgs = z.object({
  path: z.string().min(1),
  oldString: z.string().min(1),
  newString: z.string(),
  replaceAll: z.boolean().optional().default(false),
});

export const GlobArgs = z.object({
  pattern: z.string().min(1),
  cwd: z.string().optional(),
});

export const GrepArgs = z.object({
  pattern: z.string().min(1),
  glob: z.string().optional(),
  caseInsensitive: z.boolean().optional().default(false),
});

export const BashArgs = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

export const ListDirArgs = z.object({
  path: z.string().optional().default('.'),
});

export const TodoWriteArgs = z.object({
  todos: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed']),
    }),
  ),
});

export const PlanWriteArgs = z.object({
  content: z.string().min(1),
});

export const DecideArgs = z.object({
  question: z.string().min(1),
  options: z.array(
    z.object({
      label: z.string().min(1),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
    }),
  ).min(2).max(5),
});

export const HypothesisArgs = z.object({
  claim: z.string().min(1),
  verification: z.string().min(1),
  expectedOutcome: z.string().min(1),
});

export const ProofArgs = z.object({
  description: z.string().min(1),
  command: z.string().min(1),
});

export const GitStatusArgs = z.object({
  short: z.boolean().optional().default(true),
});

export const GitLogArgs = z.object({
  maxCommits: z.number().int().positive().max(50).optional().default(20),
  /** Limit to a specific file or directory (relative to workDir). */
  path: z.string().optional(),
});

export const GitDiffArgs = z.object({
  /** Specific file to diff. Omit for all changes. */
  path: z.string().optional(),
  /** Compare against this ref (defaults to HEAD). */
  ref: z.string().optional().default('HEAD'),
  /** Show stat summary only (--stat), not full patch. */
  statOnly: z.boolean().optional().default(false),
});

export const WebFetchArgs = z.object({
  url: z.string().url(),
  /** Maximum characters to return from the page. Defaults to 8 000. */
  maxLength: z.number().int().positive().max(32_000).optional().default(8_000),
});

export const WebSearchArgs = z.object({
  query: z.string().min(1),
  /** Maximum number of results to return. Defaults to 8. */
  maxResults: z.number().int().positive().max(20).optional().default(8),
});

export type ReadFileArgs = z.infer<typeof ReadFileArgs>;
export type WriteFileArgs = z.infer<typeof WriteFileArgs>;
export type EditFileArgs = z.infer<typeof EditFileArgs>;
export type GlobArgs = z.infer<typeof GlobArgs>;
export type GrepArgs = z.infer<typeof GrepArgs>;
export type BashArgs = z.infer<typeof BashArgs>;
export type ListDirArgs = z.infer<typeof ListDirArgs>;
export type TodoWriteArgs = z.infer<typeof TodoWriteArgs>;
export type PlanWriteArgs = z.infer<typeof PlanWriteArgs>;
export type DecideArgs = z.infer<typeof DecideArgs>;
export type HypothesisArgs = z.infer<typeof HypothesisArgs>;
export type ProofArgs = z.infer<typeof ProofArgs>;
export type GitStatusArgs = z.infer<typeof GitStatusArgs>;
export type GitLogArgs = z.infer<typeof GitLogArgs>;
export type GitDiffArgs = z.infer<typeof GitDiffArgs>;
export type WebFetchArgs = z.infer<typeof WebFetchArgs>;
export type WebSearchArgs = z.infer<typeof WebSearchArgs>;

// ── New tool schemas ────────────────────────────────────────────────────────

export const GitCommitArgs = z.object({
  message: z.string().min(1),
  files: z.array(z.string()).optional(), // specific files; if omitted, commits all staged
});

export const GitCreateBranchArgs = z.object({
  name: z.string().min(1),
  from: z.string().optional(), // base ref — defaults to HEAD
});

export const RunScriptArgs = z.object({
  script: z.string().min(1), // package.json script name, e.g. "test", "build"
  args: z.array(z.string()).optional(),
});

export const EnvGetArgs = z.object({
  key: z.string().min(1),
});

export const NotifyArgs = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

export const JsonPatchArgs = z.object({
  path: z.string().min(1),
  patches: z.array(z.object({
    op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
    path: z.string().min(1),
    value: z.unknown().optional(),
    from: z.string().optional(),
  })).min(1),
});

export const ImageGenerateArgs = z.object({
  prompt: z.string().min(1),
  outputPath: z.string().min(1),
  width: z.number().int().positive().max(2048).optional().default(512),
  height: z.number().int().positive().max(2048).optional().default(512),
});

export const ImageReadArgs = z.object({
  path: z.string().min(1),
});

// DB tools — all share a connectionString
const DbBase = z.object({ connectionString: z.string().min(1) });

export const DbQueryArgs = DbBase.extend({
  sql: z.string().min(1),
  params: z.array(z.unknown()).optional(),
});

export const DbExecuteArgs = DbBase.extend({
  sql: z.string().min(1),
  params: z.array(z.unknown()).optional(),
});

export const DbTransactionArgs = DbBase.extend({
  statements: z.array(z.object({
    sql: z.string().min(1),
    params: z.array(z.unknown()).optional(),
  })).min(1),
});

export const DbListTablesArgs = DbBase.extend({
  schema: z.string().optional(),
});

export const DbDescribeTableArgs = DbBase.extend({
  table: z.string().min(1),
});

export const DbListIndexesArgs = DbBase.extend({
  table: z.string().optional(),
});

export const DbShowSchemaArgs = DbBase;

export const DbListForeignKeysArgs = DbBase.extend({
  table: z.string().optional(),
});

export const DbExplainArgs = DbBase.extend({
  sql: z.string().min(1),
  analyze: z.boolean().optional().default(false),
});

export const DbSlowQueriesArgs = DbBase.extend({
  limit: z.number().int().positive().max(100).optional().default(10),
});

export const DbTableStatsArgs = DbBase.extend({
  table: z.string().min(1),
});

export const DbIndexUsageArgs = DbBase;
export const DbLocksArgs = DbBase;
export const DbConnectionsArgs = DbBase;

export const DbDumpArgs = DbBase.extend({
  outputPath: z.string().min(1),
  tables: z.array(z.string()).optional(),
});

export const DbRestoreArgs = DbBase.extend({
  inputPath: z.string().min(1),
});

export const DbMigrateArgs = DbBase.extend({
  migrationsDir: z.string().min(1),
  direction: z.enum(['up', 'down']).optional().default('up'),
});

export type GitCommitArgs = z.infer<typeof GitCommitArgs>;
export type GitCreateBranchArgs = z.infer<typeof GitCreateBranchArgs>;
export type RunScriptArgs = z.infer<typeof RunScriptArgs>;
export type EnvGetArgs = z.infer<typeof EnvGetArgs>;
export type NotifyArgs = z.infer<typeof NotifyArgs>;
export type JsonPatchArgs = z.infer<typeof JsonPatchArgs>;
export type ImageGenerateArgs = z.infer<typeof ImageGenerateArgs>;
export type ImageReadArgs = z.infer<typeof ImageReadArgs>;
export type DbQueryArgs = z.infer<typeof DbQueryArgs>;
export type DbExecuteArgs = z.infer<typeof DbExecuteArgs>;
export type DbTransactionArgs = z.infer<typeof DbTransactionArgs>;
export type DbListTablesArgs = z.infer<typeof DbListTablesArgs>;
export type DbDescribeTableArgs = z.infer<typeof DbDescribeTableArgs>;
export type DbListIndexesArgs = z.infer<typeof DbListIndexesArgs>;
export type DbShowSchemaArgs = z.infer<typeof DbShowSchemaArgs>;
export type DbListForeignKeysArgs = z.infer<typeof DbListForeignKeysArgs>;
export type DbExplainArgs = z.infer<typeof DbExplainArgs>;
export type DbSlowQueriesArgs = z.infer<typeof DbSlowQueriesArgs>;
export type DbTableStatsArgs = z.infer<typeof DbTableStatsArgs>;
export type DbIndexUsageArgs = z.infer<typeof DbIndexUsageArgs>;
export type DbLocksArgs = z.infer<typeof DbLocksArgs>;
export type DbConnectionsArgs = z.infer<typeof DbConnectionsArgs>;
export type DbDumpArgs = z.infer<typeof DbDumpArgs>;
export type DbRestoreArgs = z.infer<typeof DbRestoreArgs>;
export type DbMigrateArgs = z.infer<typeof DbMigrateArgs>;

// ── NoSQL schemas ───────────────────────────────────────────────────────────

const MongoBase = z.object({ connectionString: z.string().min(1), database: z.string().min(1) });

export const MongoQueryArgs = MongoBase.extend({
  collection: z.string().min(1),
  filter: z.string().optional().default('{}'),
  projection: z.string().optional(),
  sort: z.string().optional(),
  limit: z.number().int().positive().max(1000).optional().default(20),
});

export const MongoExecuteArgs = MongoBase.extend({
  command: z.string().min(1),
});

export const MongoListArgs = MongoBase.pick({ connectionString: true }).extend({
  database: z.string().optional(),
});

export const RedisCommandArgs = z.object({
  connectionString: z.string().optional().default('redis://localhost:6379'),
  command: z.string().min(1),
});

export const EsRequestArgs = z.object({
  baseUrl: z.string().optional().default('http://localhost:9200'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().default('GET'),
  path: z.string().min(1),
  body: z.string().optional(),
});

const CqlBase = z.object({ connectionString: z.string().optional().default('localhost') });

export const CqlQueryArgs = CqlBase.extend({
  keyspace: z.string().optional(),
  query: z.string().min(1),
});

export const CqlExecuteArgs = CqlBase.extend({
  keyspace: z.string().optional(),
  query: z.string().min(1),
});

export const Neo4jQueryArgs = z.object({
  connectionString: z.string().optional().default('bolt://localhost:7687'),
  query: z.string().min(1),
  database: z.string().optional(),
});

export const DynamodbArgs = z.object({
  operation: z.enum(['query', 'scan', 'get-item', 'put-item', 'delete-item', 'describe-table', 'list-tables']),
  tableName: z.string().optional(),
  params: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().optional(),
});

export const InfluxQueryArgs = z.object({
  url: z.string().optional().default('http://localhost:8086'),
  org: z.string().optional(),
  token: z.string().optional(),
  query: z.string().min(1),
});

export type MongoQueryArgs = z.infer<typeof MongoQueryArgs>;
export type MongoExecuteArgs = z.infer<typeof MongoExecuteArgs>;
export type MongoListArgs = z.infer<typeof MongoListArgs>;
export type RedisCommandArgs = z.infer<typeof RedisCommandArgs>;
export type EsRequestArgs = z.infer<typeof EsRequestArgs>;
export type CqlQueryArgs = z.infer<typeof CqlQueryArgs>;
export type CqlExecuteArgs = z.infer<typeof CqlExecuteArgs>;
export type Neo4jQueryArgs = z.infer<typeof Neo4jQueryArgs>;
export type DynamodbArgs = z.infer<typeof DynamodbArgs>;
export type InfluxQueryArgs = z.infer<typeof InfluxQueryArgs>;

// ── Web scraping ────────────────────────────────────────────────────────────

export const WebScrapeArgs = z.object({
  url: z.string().url(),
  selector: z.string().optional(),
  extractAttributes: z.array(z.string()).optional(),
  maxLength: z.number().int().positive().max(100_000).optional().default(16_000),
});
export type WebScrapeArgs = z.infer<typeof WebScrapeArgs>;

// ── DevOps / Infrastructure ─────────────────────────────────────────────────

export const DockerArgs = z.object({
  subcommand: z.enum(['ps', 'logs', 'inspect', 'stats', 'images', 'compose']),
  args: z.string().optional(),
});

export const K8sArgs = z.object({
  subcommand: z.enum(['get', 'describe', 'logs', 'top', 'config', 'apply', 'delete']),
  args: z.string().optional(),
  namespace: z.string().optional(),
  context: z.string().optional(),
});

export const HttpRequestArgs = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional().default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().int().positive().max(60_000).optional().default(10_000),
});

export const ServiceHealthArgs = z.object({
  url: z.string().url(),
  expectedStatus: z.number().int().positive().optional().default(200),
  timeoutMs: z.number().int().positive().max(30_000).optional().default(5_000),
});

export const PortCheckArgs = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().max(65535),
  timeoutMs: z.number().int().positive().max(10_000).optional().default(3_000),
});

export type DockerArgs = z.infer<typeof DockerArgs>;
export type K8sArgs = z.infer<typeof K8sArgs>;
export type HttpRequestArgs = z.infer<typeof HttpRequestArgs>;
export type ServiceHealthArgs = z.infer<typeof ServiceHealthArgs>;
export type PortCheckArgs = z.infer<typeof PortCheckArgs>;

// ── Security ────────────────────────────────────────────────────────────────

export const SecretScanArgs = z.object({
  path: z.string().optional().default('.'),
  patterns: z.array(z.string()).optional(),
});

export const DepAuditArgs = z.object({
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'pip', 'cargo']).optional(),
});

export const SslCheckArgs = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().max(65535).optional().default(443),
});

export type SecretScanArgs = z.infer<typeof SecretScanArgs>;
export type DepAuditArgs = z.infer<typeof DepAuditArgs>;
export type SslCheckArgs = z.infer<typeof SslCheckArgs>;

// ── Code Quality ────────────────────────────────────────────────────────────

export const CodeMetricsArgs = z.object({
  path: z.string().optional().default('.'),
  glob: z.string().optional(),
});

export const LintArgs = z.object({
  tool: z.enum(['eslint', 'ruff', 'clippy', 'golangci-lint', 'auto']).optional().default('auto'),
  path: z.string().optional().default('.'),
  fix: z.boolean().optional().default(false),
});

export const TestRunArgs = z.object({
  framework: z.enum(['vitest', 'jest', 'pytest', 'cargo', 'go', 'auto']).optional().default('auto'),
  path: z.string().optional(),
  filter: z.string().optional(),
});

export const CoverageArgs = z.object({
  framework: z.enum(['vitest', 'jest', 'pytest', 'cargo', 'go', 'auto']).optional().default('auto'),
  path: z.string().optional(),
});

export type CodeMetricsArgs = z.infer<typeof CodeMetricsArgs>;
export type LintArgs = z.infer<typeof LintArgs>;
export type TestRunArgs = z.infer<typeof TestRunArgs>;
export type CoverageArgs = z.infer<typeof CoverageArgs>;

// ── Data / Analytics ────────────────────────────────────────────────────────

export const CsvQueryArgs = z.object({
  file: z.string().min(1),
  sql: z.string().min(1),
});

export const JsonQueryArgs = z.object({
  file: z.string().min(1),
  expression: z.string().min(1),
});

export type CsvQueryArgs = z.infer<typeof CsvQueryArgs>;
export type JsonQueryArgs = z.infer<typeof JsonQueryArgs>;

// ── Cloud CLI ───────────────────────────────────────────────────────────────

export const AwsArgs = z.object({
  service: z.string().min(1),
  command: z.string().min(1),
  region: z.string().optional(),
  profile: z.string().optional(),
});

export const GcpArgs = z.object({
  command: z.string().min(1),
  project: z.string().optional(),
});

export const AzureArgs = z.object({
  command: z.string().min(1),
  subscription: z.string().optional(),
});

export type AwsArgs = z.infer<typeof AwsArgs>;
export type GcpArgs = z.infer<typeof GcpArgs>;
export type AzureArgs = z.infer<typeof AzureArgs>;

// ── Git Extras ──────────────────────────────────────────────────────────────

export const GitTagArgs = z.object({
  action: z.enum(['list', 'create', 'delete']).optional().default('list'),
  name: z.string().optional(),
  message: z.string().optional(),
  ref: z.string().optional(),
});

export const GitStashArgs = z.object({
  action: z.enum(['push', 'pop', 'list', 'drop', 'show']).optional().default('list'),
  message: z.string().optional(),
  index: z.number().int().nonnegative().optional(),
});

export const GitCherryPickArgs = z.object({
  commit: z.string().min(1),
  noCommit: z.boolean().optional().default(false),
});

export type GitTagArgs = z.infer<typeof GitTagArgs>;
export type GitStashArgs = z.infer<typeof GitStashArgs>;
export type GitCherryPickArgs = z.infer<typeof GitCherryPickArgs>;

// ── Project Management ──────────────────────────────────────────────────────

export const ChangelogArgs = z.object({
  from: z.string().optional(),
  to: z.string().optional().default('HEAD'),
  format: z.enum(['markdown', 'json']).optional().default('markdown'),
});

export type ChangelogArgs = z.infer<typeof ChangelogArgs>;

// ── Parallel Sub-Agents ─────────────────────────────────────────────────────

export const AgentSpawnArgs = z.object({
  tasks: z.array(z.object({
    description: z.string().min(1),
    prompt: z.string().min(1),
    skill: z.string().optional(),
    maxIterations: z.number().int().positive().max(10).optional().default(5),
  })).min(1).max(5),
});
export type AgentSpawnArgs = z.infer<typeof AgentSpawnArgs>;

export interface ToolDescriptor {
  name: string;
  description: string;
  requiresApproval: boolean;
  schema: z.ZodTypeAny;
}

export const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file inside the working directory.',
    requiresApproval: false,
    schema: ReadFileArgs,
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file. Requires user approval.',
    requiresApproval: true,
    schema: WriteFileArgs,
  },
  {
    name: 'edit_file',
    description: 'Replace an exact string in a file. Requires user approval.',
    requiresApproval: true,
    schema: EditFileArgs,
  },
  {
    name: 'glob',
    description: 'Find files by glob pattern (e.g. "**/*.ts").',
    requiresApproval: false,
    schema: GlobArgs,
  },
  {
    name: 'grep',
    description: 'Search file contents by regex pattern.',
    requiresApproval: false,
    schema: GrepArgs,
  },
  {
    name: 'bash',
    description: 'Run a shell command. Requires user approval.',
    requiresApproval: true,
    schema: BashArgs,
  },
  {
    name: 'list_dir',
    description: 'List entries of a directory.',
    requiresApproval: false,
    schema: ListDirArgs,
  },
  {
    name: 'todo_write',
    description: 'Replace the session todo list with the given todos.',
    requiresApproval: false,
    schema: TodoWriteArgs,
  },
  {
    name: 'plan_write',
    description:
      'Save your full implementation plan as markdown. Only available in plan mode. Call this exactly once when your investigation is complete.',
    requiresApproval: false,
    schema: PlanWriteArgs,
  },
  {
    name: 'decide',
    description:
      'Present the user with a structured decision: a question and 2-5 options with pros/cons. The agent pauses until the user picks an option. Use when there are multiple valid implementation approaches.',
    requiresApproval: false,
    schema: DecideArgs,
  },
  {
    name: 'hypothesis',
    description:
      'Record a testable hypothesis before making a change. Provide a claim, a bash command to verify it, and the expected outcome. The system will auto-evaluate after verification runs.',
    requiresApproval: false,
    schema: HypothesisArgs,
  },
  {
    name: 'proof',
    description:
      'Register a verification command (test, type check, or property assertion) that will run automatically after your next code change (write_file, edit_file, or bash). If the proof fails, the user is warned. Use to turn code changes into contracts — "if this change is correct, this command will pass."',
    requiresApproval: false,
    schema: ProofArgs,
  },
  {
    name: 'git_status',
    description: 'Show the working tree status — staged, unstaged, and untracked files.',
    requiresApproval: false,
    schema: GitStatusArgs,
  },
  {
    name: 'git_log',
    description: 'Show recent git commit history as a one-line graph. Optionally filter by file path.',
    requiresApproval: false,
    schema: GitLogArgs,
  },
  {
    name: 'git_diff',
    description: 'Show changes between the working tree and a git ref (default HEAD). Optionally limit to a single file or show stat summary only.',
    requiresApproval: false,
    schema: GitDiffArgs,
  },
  {
    name: 'web_fetch',
    description:
      'Fetch a URL and return its content as plain text. Use to read documentation, API references, GitHub files, or any public web page. Does not require approval.',
    requiresApproval: false,
    schema: WebFetchArgs,
  },
  {
    name: 'web_search',
    description:
      'Search the web and return a list of results (title, URL, snippet). Use to find documentation, packages, error explanations, or any information not available in local files.',
    requiresApproval: false,
    schema: WebSearchArgs,
  },
  // ── Git tools ─────────────────────────────────────────────────────────────
  {
    name: 'git_commit',
    description: 'Stage files and create a git commit. Requires user approval.',
    requiresApproval: true,
    schema: GitCommitArgs,
  },
  {
    name: 'git_create_branch',
    description: 'Create a new git branch from the current HEAD or a specified ref.',
    requiresApproval: false,
    schema: GitCreateBranchArgs,
  },
  // ── Utility tools ─────────────────────────────────────────────────────────
  {
    name: 'run_script',
    description: 'Run a package.json script (e.g. "test", "build") via pnpm/npm. Requires user approval.',
    requiresApproval: true,
    schema: RunScriptArgs,
  },
  {
    name: 'env_get',
    description: 'Read a single environment variable by name. Returns the value or empty if unset.',
    requiresApproval: false,
    schema: EnvGetArgs,
  },
  {
    name: 'notify',
    description: 'Send a desktop notification to the user. Use when a long task finishes.',
    requiresApproval: false,
    schema: NotifyArgs,
  },
  {
    name: 'json_patch',
    description: 'Apply RFC 6902 JSON Patch operations to a JSON file. Requires user approval.',
    requiresApproval: true,
    schema: JsonPatchArgs,
  },
  // ── Image tools ───────────────────────────────────────────────────────────
  {
    name: 'image_generate',
    description: 'Generate an image from a text prompt and save it to disk.',
    requiresApproval: false,
    schema: ImageGenerateArgs,
  },
  {
    name: 'image_read',
    description: 'Read an image file and return a description of its contents.',
    requiresApproval: false,
    schema: ImageReadArgs,
  },
  // ── Database tools ────────────────────────────────────────────────────────
  { name: 'db_query', description: 'Run a read-only SQL SELECT and return rows as JSON.', requiresApproval: false, schema: DbQueryArgs },
  { name: 'db_execute', description: 'Run an INSERT / UPDATE / DELETE / DDL statement. Requires user approval.', requiresApproval: true, schema: DbExecuteArgs },
  { name: 'db_transaction', description: 'Run multiple SQL statements in a single atomic transaction. Requires user approval.', requiresApproval: true, schema: DbTransactionArgs },
  { name: 'db_list_tables', description: 'List all tables and views in the database.', requiresApproval: false, schema: DbListTablesArgs },
  { name: 'db_describe_table', description: 'Show columns, types, constraints, and defaults for a table.', requiresApproval: false, schema: DbDescribeTableArgs },
  { name: 'db_list_indexes', description: 'List indexes — name, columns, type, uniqueness.', requiresApproval: false, schema: DbListIndexesArgs },
  { name: 'db_show_schema', description: 'Return full DDL (CREATE TABLE statements) for all tables.', requiresApproval: false, schema: DbShowSchemaArgs },
  { name: 'db_list_foreign_keys', description: 'Show foreign key constraints and the tables they reference.', requiresApproval: false, schema: DbListForeignKeysArgs },
  { name: 'db_explain', description: 'Run EXPLAIN [ANALYZE] on a query and return the execution plan.', requiresApproval: false, schema: DbExplainArgs },
  { name: 'db_slow_queries', description: 'Fetch the top N slowest queries from pg_stat_statements or the slow query log.', requiresApproval: false, schema: DbSlowQueriesArgs },
  { name: 'db_table_stats', description: 'Show row count, dead tuples, last vacuum/analyze, and bloat estimate for a table.', requiresApproval: false, schema: DbTableStatsArgs },
  { name: 'db_index_usage', description: 'Show index hit rates — identifies unused indexes.', requiresApproval: false, schema: DbIndexUsageArgs },
  { name: 'db_locks', description: 'List active locks and blocked queries.', requiresApproval: false, schema: DbLocksArgs },
  { name: 'db_connections', description: 'Show active database connections, states, and query duration.', requiresApproval: false, schema: DbConnectionsArgs },
  { name: 'db_dump', description: 'Dump database or specific tables to a SQL file.', requiresApproval: false, schema: DbDumpArgs },
  { name: 'db_restore', description: 'Restore a database from a SQL dump file. Requires user approval.', requiresApproval: true, schema: DbRestoreArgs },
  { name: 'db_migrate', description: 'Run pending migration files up or down. Requires user approval.', requiresApproval: true, schema: DbMigrateArgs },
  // ── NoSQL tools ───────────────────────────────────────────────────────────
  { name: 'mongo_query', description: 'Run a read-only MongoDB find query via mongosh. Returns JSON documents.', requiresApproval: false, schema: MongoQueryArgs },
  { name: 'mongo_execute', description: 'Run MongoDB write commands (insert, update, delete, createIndex) via mongosh. Requires approval.', requiresApproval: true, schema: MongoExecuteArgs },
  { name: 'mongo_list', description: 'List MongoDB databases or collections within a database.', requiresApproval: false, schema: MongoListArgs },
  { name: 'redis_command', description: 'Run a Redis command via redis-cli (GET, SET, HGETALL, etc). Write commands require approval.', requiresApproval: false, schema: RedisCommandArgs },
  { name: 'es_request', description: 'Make an Elasticsearch REST API request (search, mappings, indices).', requiresApproval: false, schema: EsRequestArgs },
  { name: 'cql_query', description: 'Run a read-only Cassandra CQL SELECT via cqlsh.', requiresApproval: false, schema: CqlQueryArgs },
  { name: 'cql_execute', description: 'Run a Cassandra CQL write statement (INSERT/UPDATE/DELETE/DDL) via cqlsh. Requires approval.', requiresApproval: true, schema: CqlExecuteArgs },
  { name: 'neo4j_query', description: 'Run a Cypher query against Neo4j via cypher-shell.', requiresApproval: false, schema: Neo4jQueryArgs },
  { name: 'dynamodb', description: 'Run DynamoDB operations (query, scan, get-item, put-item, etc) via AWS CLI.', requiresApproval: false, schema: DynamodbArgs },
  { name: 'influx_query', description: 'Run a Flux or InfluxQL query against InfluxDB.', requiresApproval: false, schema: InfluxQueryArgs },
  // ── Web scraping ──────────────────────────────────────────────────────────
  { name: 'web_scrape', description: 'Scrape a URL and extract structured data — text, links, headings, or specific CSS selectors.', requiresApproval: false, schema: WebScrapeArgs },
  // ── DevOps / Infrastructure ───────────────────────────────────────────────
  { name: 'docker', description: 'Run Docker commands (ps, logs, inspect, stats, images, compose).', requiresApproval: false, schema: DockerArgs },
  { name: 'k8s', description: 'Run kubectl commands (get, describe, logs, top, config, apply, delete). Apply/delete require approval.', requiresApproval: false, schema: K8sArgs },
  { name: 'http_request', description: 'Make an HTTP request and return status, headers, and body. Like curl but structured.', requiresApproval: false, schema: HttpRequestArgs },
  { name: 'service_health', description: 'Check if an HTTP service is healthy by hitting its URL and verifying the status code.', requiresApproval: false, schema: ServiceHealthArgs },
  { name: 'port_check', description: 'Check if a TCP port is open and reachable on a given host.', requiresApproval: false, schema: PortCheckArgs },
  // ── Security ──────────────────────────────────────────────────────────────
  { name: 'secret_scan', description: 'Scan files for leaked secrets, API keys, passwords, and credentials.', requiresApproval: false, schema: SecretScanArgs },
  { name: 'dep_audit', description: 'Audit project dependencies for known security vulnerabilities.', requiresApproval: false, schema: DepAuditArgs },
  { name: 'ssl_check', description: 'Check SSL/TLS certificate details for a host — expiry, issuer, chain validity.', requiresApproval: false, schema: SslCheckArgs },
  // ── Code Quality ──────────────────────────────────────────────────────────
  { name: 'code_metrics', description: 'Compute code metrics — lines of code, file counts, function counts, complexity estimates.', requiresApproval: false, schema: CodeMetricsArgs },
  { name: 'lint', description: 'Run a linter (eslint, ruff, clippy, golangci-lint) and return issues found.', requiresApproval: false, schema: LintArgs },
  { name: 'test_run', description: 'Run tests (vitest, jest, pytest, cargo test, go test) and return results.', requiresApproval: false, schema: TestRunArgs },
  { name: 'coverage', description: 'Generate test coverage report — total coverage %, uncovered files, uncovered lines.', requiresApproval: false, schema: CoverageArgs },
  // ── Data / Analytics ──────────────────────────────────────────────────────
  { name: 'csv_query', description: 'Run SQL queries against a CSV file using sqlite3. Treats the CSV as a table named "data".', requiresApproval: false, schema: CsvQueryArgs },
  { name: 'json_query', description: 'Run jq expressions against a JSON file and return the result.', requiresApproval: false, schema: JsonQueryArgs },
  // ── Cloud CLI ─────────────────────────────────────────────────────────────
  { name: 'aws', description: 'Run AWS CLI commands (s3, ec2, lambda, ecs, cloudwatch, etc).', requiresApproval: false, schema: AwsArgs },
  { name: 'gcp', description: 'Run Google Cloud CLI (gcloud) commands.', requiresApproval: false, schema: GcpArgs },
  { name: 'azure', description: 'Run Azure CLI (az) commands.', requiresApproval: false, schema: AzureArgs },
  // ── Git Extras ────────────────────────────────────────────────────────────
  { name: 'git_tag', description: 'List, create, or delete git tags.', requiresApproval: false, schema: GitTagArgs },
  { name: 'git_stash', description: 'Save, restore, list, or drop git stashes.', requiresApproval: false, schema: GitStashArgs },
  { name: 'git_cherry_pick', description: 'Cherry-pick a commit onto the current branch. Requires approval.', requiresApproval: true, schema: GitCherryPickArgs },
  // ── Project Management ────────────────────────────────────────────────────
  { name: 'changelog', description: 'Generate a changelog from git commit history between two refs.', requiresApproval: false, schema: ChangelogArgs },
  // ── Parallel Sub-Agents ───────────────────────────────────────────────────
  { name: 'agent_spawn', description: 'Spawn parallel sub-agents to work on independent tasks simultaneously. Each agent has its own thinking and read-only tool access.', requiresApproval: false, schema: AgentSpawnArgs },
];

export const TOOL_NAMES = TOOL_DESCRIPTORS.map((t) => t.name);

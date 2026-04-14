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
  timeoutMs: z.number().int().positive().max(120_000).optional(),
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
];

export const TOOL_NAMES = TOOL_DESCRIPTORS.map((t) => t.name);

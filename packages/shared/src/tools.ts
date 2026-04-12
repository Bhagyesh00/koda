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

export type ReadFileArgs = z.infer<typeof ReadFileArgs>;
export type WriteFileArgs = z.infer<typeof WriteFileArgs>;
export type EditFileArgs = z.infer<typeof EditFileArgs>;
export type GlobArgs = z.infer<typeof GlobArgs>;
export type GrepArgs = z.infer<typeof GrepArgs>;
export type BashArgs = z.infer<typeof BashArgs>;
export type ListDirArgs = z.infer<typeof ListDirArgs>;
export type TodoWriteArgs = z.infer<typeof TodoWriteArgs>;
export type PlanWriteArgs = z.infer<typeof PlanWriteArgs>;

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
];

export const TOOL_NAMES = TOOL_DESCRIPTORS.map((t) => t.name);

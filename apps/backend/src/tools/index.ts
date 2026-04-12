import { registerTool } from './registry.js';
import { readFileTool } from './readFile.js';
import { writeFileTool } from './writeFile.js';
import { editFileTool } from './editFile.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { bashTool } from './bash.js';
import { listDirTool } from './listDir.js';
import { todoWriteTool } from './todoWrite.js';
import { planWriteTool } from './planWrite.js';

let registered = false;

export function registerAllTools(): void {
  if (registered) return;
  registered = true;
  registerTool(readFileTool);
  registerTool(writeFileTool);
  registerTool(editFileTool);
  registerTool(globTool);
  registerTool(grepTool);
  registerTool(bashTool);
  registerTool(listDirTool);
  registerTool(todoWriteTool);
  registerTool(planWriteTool);
}

/** Tools allowed in plan mode (read-only + plan_write). */
export const PLAN_MODE_TOOLS = new Set([
  'read_file',
  'glob',
  'grep',
  'list_dir',
  'plan_write',
]);

export { getTool, listTools } from './registry.js';

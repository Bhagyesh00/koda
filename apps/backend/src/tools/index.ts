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
import { decideTool } from './decide.js';
import { hypothesisTool } from './hypothesis.js';
import { proofTool } from './proof.js';
import { webFetchTool } from './webFetch.js';
import { webSearchTool } from './webSearch.js';
import { gitStatusTool } from './gitStatus.js';
import { gitLogTool } from './gitLog.js';
import { gitDiffTool } from './gitDiff.js';

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
  registerTool(decideTool);
  registerTool(hypothesisTool);
  registerTool(proofTool);
  registerTool(webFetchTool);
  registerTool(webSearchTool);
  registerTool(gitStatusTool);
  registerTool(gitLogTool);
  registerTool(gitDiffTool);
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

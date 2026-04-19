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
// New tools
import { gitCommitTool } from './gitCommit.js';
import { gitCreateBranchTool } from './gitCreateBranch.js';
import { runScriptTool } from './runScript.js';
import { envGetTool } from './envGet.js';
import { notifyTool } from './notify.js';
import { jsonPatchTool } from './jsonPatch.js';
import { imageGenerateTool } from './imageGenerate.js';
import { imageReadTool } from './imageRead.js';
import { dbQueryTool } from './dbQuery.js';
import { dbExecuteTool } from './dbExecute.js';
import { dbTransactionTool } from './dbTransaction.js';
import { dbListTablesTool } from './dbListTables.js';
import { dbDescribeTableTool } from './dbDescribeTable.js';
import { dbListIndexesTool } from './dbListIndexes.js';
import { dbShowSchemaTool } from './dbShowSchema.js';
import { dbListForeignKeysTool } from './dbListForeignKeys.js';
import { dbExplainTool } from './dbExplain.js';
import { dbSlowQueriesTool } from './dbSlowQueries.js';
import { dbTableStatsTool } from './dbTableStats.js';
import { dbIndexUsageTool } from './dbIndexUsage.js';
import { dbLocksTool } from './dbLocks.js';
import { dbConnectionsTool } from './dbConnections.js';
import { dbDumpTool } from './dbDump.js';
import { dbRestoreTool } from './dbRestore.js';
import { dbMigrateTool } from './dbMigrate.js';
// NoSQL tools
import { mongoQueryTool } from './mongoQuery.js';
import { mongoExecuteTool } from './mongoExecute.js';
import { mongoListTool } from './mongoList.js';
import { redisCommandTool } from './redisCommand.js';
import { esRequestTool } from './esRequest.js';
import { cqlQueryTool } from './cqlQuery.js';
import { cqlExecuteTool } from './cqlExecute.js';
import { neo4jQueryTool } from './neo4jQuery.js';
import { dynamodbTool } from './dynamodb.js';
import { influxQueryTool } from './influxQuery.js';
// DevOps / Infrastructure / Security tools
import { webScrapeTool } from './webScrape.js';
import { browserTool } from './browser.js';
import { dockerTool } from './docker.js';
import { k8sTool } from './k8s.js';
import { httpRequestTool } from './httpRequest.js';
import { serviceHealthTool } from './serviceHealth.js';
import { portCheckTool } from './portCheck.js';
import { secretScanTool } from './secretScan.js';
import { depAuditTool } from './depAudit.js';
import { sslCheckTool } from './sslCheck.js';
// Code Quality
import { codeMetricsTool } from './codeMetrics.js';
import { lintTool } from './lint.js';
import { testRunTool } from './testRun.js';
import { coverageTool } from './coverage.js';
// Data / Analytics
import { csvQueryTool } from './csvQuery.js';
import { jsonQueryTool } from './jsonQuery.js';
// Cloud CLI
import { awsTool } from './aws.js';
import { gcpTool } from './gcp.js';
import { azureTool } from './azure.js';
// Git Extras
import { gitTagTool } from './gitTag.js';
import { gitStashTool } from './gitStash.js';
import { gitCherryPickTool } from './gitCherryPick.js';
// Project Management
import { changelogTool } from './changelog.js';
// Parallel Sub-Agents
import { agentSpawnTool } from './agentSpawn.js';
// NL→SQL
import { nlToSqlTool } from './nlToSql.js';
// Selenium prompt-based test
import { seleniumTestTool } from './seleniumTest.js';
import { seleniumSuiteTool } from './seleniumSuite.js';
import { seleniumFromVideoTool } from './seleniumFromVideo.js';
import { repoRefactorTool } from './repoRefactor.js';
import { ttsSpeakTool } from './ttsSpeak.js';
import { scene3dTool } from './scene3d.js';
// Phase 31 — market-gap features
import { constraintAddTool, constraintListTool, constraintRemoveTool } from './constraints.js';
import { checkpointSaveTool, checkpointListTool } from './checkpoints.js';
import { repoGraphTool } from './repoGraph.js';
import { refactorTxTool } from './refactorTx.js';
import { multiAgentTool } from './multiAgent.js';
import { deployGateTool } from './deployGate.js';
import { importVerifyTool } from './importVerify.js';
import { edgeCaseTestsTool } from './edgeCaseTests.js';
import { perfCheckTool } from './perfCheck.js';
import { prReviewTool, diffSummarizeTool } from './prReview.js';

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
  // New tools
  registerTool(gitCommitTool);
  registerTool(gitCreateBranchTool);
  registerTool(runScriptTool);
  registerTool(envGetTool);
  registerTool(notifyTool);
  registerTool(jsonPatchTool);
  registerTool(imageGenerateTool);
  registerTool(imageReadTool);
  registerTool(dbQueryTool);
  registerTool(dbExecuteTool);
  registerTool(dbTransactionTool);
  registerTool(dbListTablesTool);
  registerTool(dbDescribeTableTool);
  registerTool(dbListIndexesTool);
  registerTool(dbShowSchemaTool);
  registerTool(dbListForeignKeysTool);
  registerTool(dbExplainTool);
  registerTool(dbSlowQueriesTool);
  registerTool(dbTableStatsTool);
  registerTool(dbIndexUsageTool);
  registerTool(dbLocksTool);
  registerTool(dbConnectionsTool);
  registerTool(dbDumpTool);
  registerTool(dbRestoreTool);
  registerTool(dbMigrateTool);
  // NoSQL tools
  registerTool(mongoQueryTool);
  registerTool(mongoExecuteTool);
  registerTool(mongoListTool);
  registerTool(redisCommandTool);
  registerTool(esRequestTool);
  registerTool(cqlQueryTool);
  registerTool(cqlExecuteTool);
  registerTool(neo4jQueryTool);
  registerTool(dynamodbTool);
  registerTool(influxQueryTool);
  // DevOps / Infrastructure / Security tools
  registerTool(webScrapeTool);
  registerTool(browserTool);
  registerTool(dockerTool);
  registerTool(k8sTool);
  registerTool(httpRequestTool);
  registerTool(serviceHealthTool);
  registerTool(portCheckTool);
  registerTool(secretScanTool);
  registerTool(depAuditTool);
  registerTool(sslCheckTool);
  // Code Quality
  registerTool(codeMetricsTool);
  registerTool(lintTool);
  registerTool(testRunTool);
  registerTool(coverageTool);
  // Data / Analytics
  registerTool(csvQueryTool);
  registerTool(jsonQueryTool);
  // Cloud CLI
  registerTool(awsTool);
  registerTool(gcpTool);
  registerTool(azureTool);
  // Git Extras
  registerTool(gitTagTool);
  registerTool(gitStashTool);
  registerTool(gitCherryPickTool);
  // Project Management
  registerTool(changelogTool);
  // Parallel Sub-Agents
  registerTool(agentSpawnTool);
  // NL→SQL
  registerTool(nlToSqlTool);
  // Selenium prompt-based test
  registerTool(seleniumTestTool);
  registerTool(seleniumSuiteTool);
  registerTool(seleniumFromVideoTool);
  // Repo refactor
  registerTool(repoRefactorTool);
  // TTS
  registerTool(ttsSpeakTool);
  // 3D scene understanding
  registerTool(scene3dTool);
  // Phase 31 — market-gap features
  registerTool(constraintAddTool);
  registerTool(constraintListTool);
  registerTool(constraintRemoveTool);
  registerTool(checkpointSaveTool);
  registerTool(checkpointListTool);
  registerTool(repoGraphTool);
  registerTool(refactorTxTool);
  registerTool(multiAgentTool);
  registerTool(deployGateTool);
  registerTool(importVerifyTool);
  registerTool(edgeCaseTestsTool);
  registerTool(perfCheckTool);
  registerTool(prReviewTool);
  registerTool(diffSummarizeTool);
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

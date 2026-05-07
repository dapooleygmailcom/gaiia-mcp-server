import { executeGraphQL, logger } from '../core/index.js';
import { walkDirectory, chunkFiles, parseRefactoredContent, writeFileData, getRepoContext } from "../file-walker.js";
import crypto from "crypto";

const PROCESS_TASK_MUTATION = `
  mutation ProcessTask($expertEmail: String!, $codeContent: String!, $auditId: String, $chunkIndex: Int, $repoName: String, $branch: String, $mode: String) {
    processTask(expertEmail: $expertEmail, codeContent: $codeContent, auditId: $auditId, chunkIndex: $chunkIndex, repoName: $repoName, branch: $branch, mode: $mode)
  }
`;

const SYNTHESIZE_AUDIT_MUTATION = `
  mutation SynthesizeAudit($expertEmail: String!, $auditId: String!, $mode: String!, $repoName: String, $branch: String, $totalChunkEc: Int) {
    synthesizeAudit(expertEmail: $expertEmail, auditId: $auditId, mode: $mode, repoName: $repoName, branch: $branch, totalChunkEc: $totalChunkEc)
  }
`;

const GET_AUDIT_RESULT_QUERY = `
  query GetAuditResult($expertEmail: String!, $auditId: String!) {
    getAuditResult(expertEmail: $expertEmail, auditId: $auditId)
  }
`;

let activeExpertEmail: string | null = null;

export function setActiveExpert(email: string) {
  activeExpertEmail = email;
}

export function getActiveExpert() {
  return activeExpertEmail;
}

export async function handleTransform(code: string, instructions: string) {
  if (!activeExpertEmail) {
    throw new Error("No active expert set. Use gaiia_set_active_expert first.");
  }

  const fullInput = `[INSTRUCTIONS]\n${instructions}\n\n[SOURCE_CODE]\n${code}`;
  const data = await executeGraphQL(PROCESS_TASK_MUTATION, {
    expertEmail: activeExpertEmail,
    codeContent: fullInput,
  });

  return data.processTask;
}

export async function handleAnalyzeProject(directory_path: string, mode: "audit" | "refactor" = "audit") {
  if (!activeExpertEmail) {
    throw new Error("No active expert set. Use gaiia_set_active_expert first.");
  }

  logger.info(`Starting project ${mode} for: ${directory_path}`);
  const { repoName, branch } = getRepoContext(directory_path);
  const auditId = crypto.randomUUID();
  
  const files = walkDirectory(directory_path);
  if (files.length === 0) {
    throw new Error("No valid code files found.");
  }

  const chunks = chunkFiles(files);
  logger.info(`Split project into ${chunks.length} chunks. Audit ID: ${auditId}`);

  let totalChunkEc = 0;

  for (let i = 0; i < chunks.length; i++) {
    logger.info(`Processing chunk ${i + 1}/${chunks.length}...`);
    
    let chunkInput = chunks[i];
    if (mode === "refactor") {
      chunkInput = `[REFACTOR_TASK]\nCRITICAL: REFACTOR MODE ENABLED.\n\nFILES TO REFACTOR:\n${chunks[i]}`;
    }

    const data = await executeGraphQL(PROCESS_TASK_MUTATION, {
      expertEmail: activeExpertEmail,
      codeContent: chunkInput,
      auditId,
      chunkIndex: i,
      repoName,
      branch,
      mode
    });

    const chunkResponse = data.processTask || "";
    if (chunkResponse.includes("[STATUS]: Error") || chunkResponse.includes("## [ERROR_DETAILS]")) {
      logger.error(`Critical failure in chunk ${i + 1}. Aborting audit.`);
      throw new Error(`Audit Aborted: Chunk ${i + 1} failed with error:\n\n${chunkResponse}`);
    }

    try {
      const parsed = JSON.parse(chunkResponse);
      if (parsed.actualEc) {
        totalChunkEc += parsed.actualEc;
        logger.info(`Chunk ${i + 1} cost: ${parsed.actualEc} EC (Total so far: ${totalChunkEc})`);
      }
    } catch (e) {
      // Not JSON, ignore
    }
  }

  logger.info(`All chunks uploaded. Triggering synthesis...`);
  await executeGraphQL(SYNTHESIZE_AUDIT_MUTATION, {
      expertEmail: activeExpertEmail,
      auditId,
      mode,
      repoName,
      branch,
      totalChunkEc
  });

  logger.info(`Synthesis triggered. Polling for results...`);
  const finalResponse = await pollForResults(activeExpertEmail, auditId);
  logger.info(`Received final response (${finalResponse.length} bytes).`);

  if (mode === "refactor") {
      const parts = finalResponse.split(/\[REVISED_CODE\]:?/i);
      if (parts.length > 1) {
        const combinedContent = parts.slice(1).join("\n");
        const refactoredFiles = parseRefactoredContent(combinedContent);
        
        for (const rf of refactoredFiles) {
          logger.info(`Applying refactor to: ${rf.path}`);
          writeFileData(directory_path, rf);
        }
      }
      return `# GAIIA Refactor Complete\n\nSuccessfully processed chunks and applied refactors. Result length: ${finalResponse.length} chars.`;
  }

  return finalResponse;
}

async function pollForResults(expertEmail: string, auditId: string): Promise<string> {
    const maxAttempts = 60; // 5 minutes
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            const data = await executeGraphQL(GET_AUDIT_RESULT_QUERY, { expertEmail, auditId });
            const result = data.getAuditResult;
            if (result) {
                if (result.startsWith("http")) {
                  logger.info(`Result ready at S3. Fetching...`);
                  const res = await fetch(result);
                  return await res.text();
                }
                return result;
            }
        } catch (e) {
            logger.error(`Polling error:`, e);
        }
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (attempts % 6 === 0) {
            logger.info(`Analysis in progress... ${Math.min(Math.round((attempts / maxAttempts) * 100), 99)}% (${attempts * 5}s elapsed)`);
        }
    }
    throw new Error("Audit synthesis timed out. Please check the dashboard later.");
}

import { executeGraphQL, logger } from '../core/index.js';
import { walkDirectory, chunkFiles, parseRefactoredContent, writeFileData, getRepoContext } from "../file-walker.js";
import crypto from "crypto";

const SUBMIT_JOB_MUTATION = `
  mutation SubmitJob($jobType: String!, $payload: String!, $auditId: String) {
    submitJob(jobType: $jobType, payload: $payload, auditId: $auditId) {
      jobId
      status
    }
  }
`;

const GET_JOB_STATUS_QUERY = `
  query GetJobStatus($jobId: ID!) {
    getJobStatus(jobId: $jobId) {
      jobId
      status
      result
    }
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
  
  const payload = JSON.stringify({
    expertEmail: activeExpertEmail,
    codeContent: fullInput,
  });

  const data = await executeGraphQL(SUBMIT_JOB_MUTATION, {
    jobType: "PROCESS_CHUNK",
    payload
  });

  const jobId = data.submitJob.jobId;
  logger.info(`Submitted inline refactor job ${jobId}. Polling...`);
  
  const result = await pollForJob(jobId);
  return result;
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
  const chunkJobIds: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    let chunkInput = chunks[i];
    if (mode === "refactor") {
      chunkInput = `[REFACTOR_TASK]\nCRITICAL: REFACTOR MODE ENABLED.\n\nFILES TO REFACTOR:\n${chunks[i]}`;
    }

    const payload = JSON.stringify({
      expertEmail: activeExpertEmail,
      codeContent: chunkInput,
      auditId,
      chunkIndex: i,
      repoName,
      branch,
      mode
    });

    const data = await executeGraphQL(SUBMIT_JOB_MUTATION, {
      jobType: "PROCESS_CHUNK",
      payload,
      auditId
    });

    chunkJobIds.push(data.submitJob.jobId);
  }

  logger.info(`Submitted ${chunkJobIds.length} chunk jobs. Polling for chunk completion...`);
  const chunkResults = await pollForMultipleJobs(chunkJobIds);

  for (const result of chunkResults) {
    try {
      const parsed = JSON.parse(result);
      if (parsed.actualEc) {
        totalChunkEc += parsed.actualEc;
      }
    } catch (e) {}
  }
  logger.info(`All chunks processed. Total Chunk EC: ${totalChunkEc}. Triggering synthesis...`);
  
  const synthPayload = JSON.stringify({
    expertEmail: activeExpertEmail,
    auditId,
    mode,
    repoName,
    branch,
    totalChunkEc
  });

  const synthData = await executeGraphQL(SUBMIT_JOB_MUTATION, {
      jobType: "SYNTHESIZE_AUDIT",
      payload: synthPayload,
      auditId
  });

  const synthJobId = synthData.submitJob.jobId;
  logger.info(`Synthesis job ${synthJobId} submitted. Polling for results...`);
  await pollForJob(synthJobId);

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

export async function handleIngestProject(directory_path: string) {
  if (!activeExpertEmail) {
    throw new Error("No active expert set. Use gaiia_set_active_expert first.");
  }

  logger.info(`Starting project ingestion for: ${directory_path}`);
  const { repoName, branch } = getRepoContext(directory_path);
  const auditId = crypto.randomUUID();
  
  const files = walkDirectory(directory_path);
  if (files.length === 0) {
    throw new Error("No valid code files found.");
  }

  const chunks = chunkFiles(files);
  logger.info(`Split project into ${chunks.length} chunks. Audit ID: ${auditId}`);

  const chunkJobIds: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const payload = JSON.stringify({
      expertEmail: activeExpertEmail,
      codeContent: chunks[i],
      auditId,
      chunkIndex: i,
      repoName,
      branch,
      mode: "ingest"
    });

    const data = await executeGraphQL(SUBMIT_JOB_MUTATION, {
      jobType: "INGEST_CHUNK",
      payload,
      auditId
    });
    
    chunkJobIds.push(data.submitJob.jobId);
  }

  logger.info(`Submitted ${chunkJobIds.length} ingest jobs to background queue. Polling for completion...`);
  await pollForMultipleJobs(chunkJobIds);

  return `Successfully ingested ${chunks.length} chunks from ${directory_path} into expert memory.`;
}

async function pollForJob(jobId: string): Promise<string> {
    const maxAttempts = 180; // 15 minutes max
    let attempts = 0;

    while (attempts < maxAttempts) {
        const data = await executeGraphQL(GET_JOB_STATUS_QUERY, { jobId });
        const job = data.getJobStatus;
        if (job) {
            if (job.status === "COMPLETED") return job.result || "Success";
            if (job.status === "FAILED") throw new Error(`Job ${jobId} failed: ${job.result}`);
        }
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error(`Job ${jobId} timed out after 15 minutes.`);
}

async function pollForMultipleJobs(jobIds: string[]): Promise<string[]> {
    const pendingJobs = new Set(jobIds);
    const completedResults: string[] = [];
    const maxAttempts = 180;
    let attempts = 0;

    while (pendingJobs.size > 0 && attempts < maxAttempts) {
        for (const jobId of Array.from(pendingJobs)) {
            const data = await executeGraphQL(GET_JOB_STATUS_QUERY, { jobId });
            const job = data.getJobStatus;
            if (job) {
                if (job.status === "COMPLETED") {
                    pendingJobs.delete(jobId);
                    if (job.result) completedResults.push(job.result);
                    logger.info(`Chunk Job ${jobId} completed. ${pendingJobs.size} remaining.`);
                } else if (job.status === "FAILED") {
                    throw new Error(`Chunk Job ${jobId} failed: ${job.result}`);
                }
            }
        }
        if (pendingJobs.size > 0) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    if (pendingJobs.size > 0) {
        throw new Error(`Wait for multiple jobs timed out. ${pendingJobs.size} jobs still pending.`);
    }

    return completedResults;
}

async function pollForResults(expertEmail: string, auditId: string): Promise<string> {
    const maxAttempts = 120; // 10 minutes
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
    }
    throw new Error("Audit synthesis timed out fetching final S3 URL.");
}

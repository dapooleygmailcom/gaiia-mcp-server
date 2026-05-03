import "./logger.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { executeGraphQL } from "./appsync-client.js";
import { walkDirectory, chunkFiles, parseRefactoredContent, writeFileData, getRepoContext } from "./file-walker.js";
import { z } from "zod";
import fs from "fs";
import crypto from "crypto";

const server = new Server(
  {
    name: "GAIIA Logic Proxy",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let activeExpertEmail: string | null = null;

const LIST_EXPERTS_QUERY = `
  query SearchExperts($query: String) {
    searchExperts(query: $query) {
      email
      name
      description
    }
  }
`;

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

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "gaiia_list_experts",
        description: "List available AI experts and their specialties.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional search query" },
          },
        },
      },
      {
        name: "gaiia_set_active_expert",
        description: "Select an expert to use for code transformations.",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "The email of the expert" },
          },
          required: ["email"],
        },
      },
      {
        name: "gaiia_transform",
        description: "Audit, refactor, or generate code using the active GAIIA expert.",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "The code block to process" },
            instructions: { type: "string", description: "Instructions for the expert (e.g., 'Refactor to use hooks')" },
          },
          required: ["code", "instructions"],
        },
      },
      {
        name: "gaiia_analyze_project",
        description: "Perform a deep architectural audit of an entire local project directory.",
        inputSchema: {
          type: "object",
          properties: {
            directory_path: { type: "string", description: "The absolute path to the project directory" },
            mode: { type: "string", enum: ["audit", "refactor"], description: "Default is 'audit'. 'refactor' will apply changes to files." },
          },
          required: ["directory_path"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "gaiia_list_experts": {
        const { query } = args as { query?: string };
        const data = await executeGraphQL(LIST_EXPERTS_QUERY, { query });
        return {
          content: [{ type: "text", text: JSON.stringify(data.searchExperts, null, 2) }],
        };
      }

      case "gaiia_set_active_expert": {
        const { email } = args as { email: string };
        activeExpertEmail = email;
        return {
          content: [{ type: "text", text: `Active expert set to: ${email}` }],
        };
      }

      case "gaiia_transform": {
        const { code, instructions } = args as { code: string; instructions: string };
        
        if (!activeExpertEmail) {
          return {
            isError: true,
            content: [{ type: "text", text: "No active expert set. Use gaiia_set_active_expert first." }],
          };
        }

        const fullInput = `[INSTRUCTIONS]\n${instructions}\n\n[SOURCE_CODE]\n${code}`;
        const data = await executeGraphQL(PROCESS_TASK_MUTATION, {
          expertEmail: activeExpertEmail,
          codeContent: fullInput,
        });

        return {
          content: [{ type: "text", text: data.processTask }],
        };
      }

      case "gaiia_analyze_project": {
        const { directory_path, mode = "audit" } = args as { directory_path: string; mode?: "audit" | "refactor" };
        
        if (!activeExpertEmail) {
          return {
            isError: true,
            content: [{ type: "text", text: "No active expert set. Use gaiia_set_active_expert first." }],
          };
        }

        console.info(`[GAIIA] Starting project ${mode} for: ${directory_path}`);
        const { repoName, branch } = getRepoContext(directory_path);
        const auditId = crypto.randomUUID();
        
        const files = walkDirectory(directory_path);
        if (files.length === 0) {
          return { isError: true, content: [{ type: "text", text: "No valid code files found." }] };
        }

        const chunks = chunkFiles(files);
        console.info(`[GAIIA] Split project into ${chunks.length} chunks. Audit ID: ${auditId}`);

        let totalChunkEc = 0;

        for (let i = 0; i < chunks.length; i++) {
          console.info(`[GAIIA] Processing chunk ${i + 1}/${chunks.length}...`);
          
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

          // [FAIL-FAST] Check if the chunk audit itself failed
          const chunkResponse = data.processTask || "";
          if (chunkResponse.includes("[STATUS]: Error") || chunkResponse.includes("## [ERROR_DETAILS]")) {
            console.error(`[GAIIA] Critical failure in chunk ${i + 1}. Aborting audit.`);
            return {
              isError: true,
              content: [{ type: "text", text: `### ❌ Audit Aborted\nChunk ${i + 1} failed with error:\n\n${chunkResponse}` }],
            };
          }

          // Accumulate cost if returned in JSON
          try {
            const parsed = JSON.parse(chunkResponse);
            if (parsed.actualEc) {
              totalChunkEc += parsed.actualEc;
              console.info(`[GAIIA] Chunk ${i + 1} cost: ${parsed.actualEc} EC (Total so far: ${totalChunkEc})`);
            }
          } catch (e) {
            // Not JSON, likely an older version or inline response — ignore
          }
        }

        console.info(`[GAIIA] All chunks uploaded. Triggering synthesis...`);
        await executeGraphQL(SYNTHESIZE_AUDIT_MUTATION, {
            expertEmail: activeExpertEmail,
            auditId,
            mode,
            repoName,
            branch,
            totalChunkEc
        });

        console.info(`[GAIIA] Synthesis triggered. Polling for results...`);
        const finalResponse = await pollForResults(activeExpertEmail, auditId);
        console.info(`[GAIIA] Received final response (${finalResponse.length} bytes).`);

        if (mode === "refactor") {
            console.error(`[GAIIA] DEBUG_START\n${finalResponse}\n[GAIIA] DEBUG_END`);
            const parts = finalResponse.split(/\[REVISED_CODE\]:?/i);
            if (parts.length > 1) {
              const combinedContent = parts.slice(1).join("\n");
              const refactoredFiles = parseRefactoredContent(combinedContent);
              
              if (refactoredFiles.length === 0) {
                console.warn("[GAIIA] No refactored files parsed from response, even though REVISED_CODE marker was present.");
              }

              for (const rf of refactoredFiles) {
                console.info(`[GAIIA] Applying refactor to: ${rf.path}`);
                writeFileData(directory_path, rf);
              }
            } else {
              console.warn("[GAIIA] No [REVISED_CODE] marker found in synthesized response.");
            }
            return {
                content: [{ type: "text", text: `# GAIIA Refactor Complete\n\nSuccessfully processed chunks and applied refactors. Result length: ${finalResponse.length} chars.` }],
            };
        }

        return {
            content: [{ type: "text", text: finalResponse }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `GAIIA Error: ${error.message}` }],
    };
  }
});

async function pollForResults(expertEmail: string, auditId: string): Promise<string> {
    const maxAttempts = 60; // 5 minutes (5s interval)
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            const data = await executeGraphQL(GET_AUDIT_RESULT_QUERY, { expertEmail, auditId });
            const result = data.getAuditResult;
            if (result) {
                // If result is a signed URL, fetch the actual content
                if (result.startsWith("http")) {
                  console.info(`[GAIIA] Result ready at S3. Fetching...`);
                  const res = await fetch(result);
                  return await res.text();
                }
                return result;
            }
        } catch (e) {
            console.error(`[GAIIA] Polling error:`, e);
        }
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (attempts % 6 === 0) {
            const elapsed = attempts * 5;
            const progress = Math.min(Math.round((attempts / maxAttempts) * 100), 99);
            console.info(`[GAIIA] Analysis in progress... ${progress}% (${elapsed}s elapsed)`);
        }
    }
    throw new Error("Audit synthesis timed out. Please check the dashboard later.");
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.info("GAIIA MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

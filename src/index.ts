import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { executeGraphQL } from "./appsync-client.js";
import { walkDirectory, chunkFiles, parseRefactoredContent, writeFileData } from "./file-walker.js";
import { z } from "zod";
import fs from "fs";

// MCP uses stdout for JSON-RPC, so all logging must go to stderr.
// We redirect console.info to console.error so we can use .info in code 
// without breaking the protocol or giving the impression of an error.
console.info = console.error;

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
  mutation ProcessTask($expertEmail: String!, $codeContent: String!) {
    processTask(expertEmail: $expertEmail, codeContent: $codeContent)
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
        
        const files = walkDirectory(directory_path);
        if (files.length === 0) {
          return {
            isError: true,
            content: [{ type: "text", text: "No valid code files found in the specified directory." }],
          };
        }

        const chunks = chunkFiles(files);
        console.info(`[GAIIA] Split project into ${chunks.length} chunks.`);

        const chunkResults: string[] = [];
        const modifiedFiles: string[] = [];

        for (let i = 0; i < chunks.length; i++) {
          console.info(`[GAIIA] Processing chunk ${i + 1}/${chunks.length} (${mode})...`);
          
          let chunkInput = chunks[i];
          if (mode === "refactor") {
            chunkInput = `[REFACTOR_TASK]\nCRITICAL: You are in REFACTOR MODE. Perform a full repository-wide refactor of the following files according to the [EXPERT_MANIFEST].\n\nRULES:\n1. All updated code MUST be placed inside a single [REVISED_CODE] block.\n2. Each file must be preceded by '--- File: path ---' markers.\n3. Return the COMPLETE content of each modified file.\n\nFILES TO REFACTOR:\n${chunks[i]}`;
          }

          const data = await executeGraphQL(PROCESS_TASK_MUTATION, {
            expertEmail: activeExpertEmail,
            codeContent: chunkInput,
          });

          fs.writeFileSync("debug_expert_response.txt", data.processTask);
          console.info(`[GAIIA] Expert Response length: ${data.processTask.length}`);
          chunkResults.push(data.processTask);

          if (mode === "refactor") {
            // Extract REVISED_CODE block - handle optional colon, whitespace, and markdown blocks
            const revisedCodeMatch = data.processTask.match(/\[REVISED_CODE\]:?\s*?\n(?:```(?:[a-z]+)?\n)?([\s\S]*?)(?:\n```|$)/i);
            if (revisedCodeMatch) {
              const cleanContent = revisedCodeMatch[1].replace(/^```[a-z]*\n/i, "").replace(/\n```$/i, "");
              const refactoredFiles = parseRefactoredContent(cleanContent);
              for (const rf of refactoredFiles) {
                console.info(`[GAIIA] Applying refactor to: ${rf.path}`);
                writeFileData(directory_path, rf);
                modifiedFiles.push(rf.path);
              }
            }
          }
        }

        if (mode === "audit") {
            console.info(`[GAIIA] Synthesizing final audit report...`);
            const synthesisPrompt = `[EXPERT_AUDITS_FOR_SYNTHESIS]\n${chunkResults.join("\n\n--- Next Chunk Audit ---\n\n")}`;
            const finalData = await executeGraphQL(PROCESS_TASK_MUTATION, {
                expertEmail: activeExpertEmail,
                codeContent: synthesisPrompt,
            });

            return {
                content: [{ type: "text", text: finalData.processTask }],
            };
        } else {
            return {
                content: [{ type: "text", text: `# GAIIA Refactor Complete\n\nSuccessfully refactored and updated ${modifiedFiles.length} files in ${directory_path}.\n\n### Modified Files:\n${modifiedFiles.map(f => `- ${f}`).join("\n")}` }],
            };
        }
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.info("GAIIA MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

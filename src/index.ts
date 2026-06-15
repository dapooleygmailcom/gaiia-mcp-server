import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { executeGraphQL, logger } from "./core/index.js";
import { handleTransform, handleAnalyzeProject, handleIngestProject, setActiveExpert } from "./handlers/transformation-handler.js";
import { handleInterrogateEndpoint } from "./handlers/integrator-handler.js";
import { handleListBpmnTemplates, handleTriggerProcessInstance } from "./handlers/workflow-handler.js";
import { SyncService } from "./services/sync-service.js";
import "dotenv/config";

const server = new Server(
  {
    name: "GAIIA Unified MCP",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const LIST_EXPERTS_QUERY = `
  query SearchExperts($query: String) {
    searchExperts(query: $query) {
      email
      name
      description
    }
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
        name: "sync_specs",
        description: "Synchronizes all locally discovered API specifications in the 'specs/' directory to the GAIIA Registry.",
        inputSchema: {
          type: "object",
          properties: {}
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
            instructions: { type: "string", description: "Instructions for the expert" },
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
            mode: { type: "string", enum: ["audit", "refactor"], description: "Default is 'audit'." },
          },
          required: ["directory_path"],
        },
      },
      {
        name: "gaiia_ingest_project",
        description: "Scan a local project directory and ingest its code samples into the active expert's VectorDB memory.",
        inputSchema: {
          type: "object",
          properties: {
            directory_path: { type: "string", description: "The absolute path to the project directory" },
          },
          required: ["directory_path"],
        },
      },
      {
        name: "interrogate_endpoint",
        description: "Intelligently interrogates a REST endpoint to discover its schema via reinforcement learning loop.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The full URL of the endpoint." },
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "GRAPHQL", "AUTO"] },
            auth_header: { type: "string", description: "Optional Authorization header." },
            base_payload: { type: "object", description: "Optional base JSON payload." },
            extra_headers: { type: "object", additionalProperties: { type: "string" } },
          },
          required: ["url", "method"],
        },
      },
      {
        name: "gaiia_list_processes",
        description: "List all registered BPMN process blueprints/templates in the GAIIA registry for the authenticated tenant.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "gaiia_start_process",
        description: "Starts/triggers an instance of a registered BPMN process blueprint with an optional custom payload.",
        inputSchema: {
          type: "object",
          properties: {
            process_type: { type: "string", description: "The unique processType/slug of the BPMN blueprint (e.g. driver-roster-change)" },
            payload: { type: "object", description: "Optional custom JSON payload context for the process run" },
          },
          required: ["process_type"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const meta: any = request.meta || {};
  const traceId = meta.traceId || (args as any)?._traceId;
  
  logger.info(`Handling tool call: ${name}`, { traceId, component: 'MCPServer' });

  try {
    switch (name) {
      case "gaiia_list_experts": {
        const { query } = args as { query?: string };
        const data = await executeGraphQL(LIST_EXPERTS_QUERY, { query });
        return { content: [{ type: "text", text: JSON.stringify(data.searchExperts, null, 2) }] };
      }

      case "gaiia_set_active_expert": {
        const { email } = args as { email: string };
        setActiveExpert(email);
        return { content: [{ type: "text", text: `Active expert set to: ${email}` }] };
      }

      case "gaiia_transform": {
        const { code, instructions } = args as { code: string; instructions: string };
        const result = await handleTransform(code, instructions);
        return { content: [{ type: "text", text: result }] };
      }

      case "gaiia_analyze_project": {
        const { directory_path, mode = "audit" } = args as { directory_path: string; mode?: "audit" | "refactor" };
        const result = await handleAnalyzeProject(directory_path, mode);
        return { content: [{ type: "text", text: result }] };
      }

      case "gaiia_ingest_project": {
        const { directory_path } = args as { directory_path: string };
        const result = await handleIngestProject(directory_path);
        return { content: [{ type: "text", text: result }] };
      }

      case "interrogate_endpoint": {
        const { url, method, auth_header, base_payload, extra_headers } = args as any;
        const result = await handleInterrogateEndpoint(url, method, auth_header, base_payload, extra_headers);
        return { content: [{ type: "text", text: result }] };
      }

      case "gaiia_list_processes": {
        const templates = await handleListBpmnTemplates();
        return { content: [{ type: "text", text: JSON.stringify(templates, null, 2) }] };
      }

      case "gaiia_start_process": {
        const { process_type, payload } = args as { process_type: string; payload?: any };
        const result = await handleTriggerProcessInstance(process_type, payload);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "sync_specs":
        const syncResult = await SyncService.syncLocalSpecs();
        return {
          content: [{ type: "text", text: syncResult }]
        };

      default:
        throw new Error("Unknown tool");
    }
  } catch (error: any) {
    logger.error(`Error executing tool ${name}: ${error.message}`, { traceId, component: 'MCPServer' });
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("GAIIA Unified MCP Server running on stdio");
}

main().catch((error) => {
  logger.error("Fatal error in main():", error);
  process.exit(1);
});

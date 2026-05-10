import axios from 'axios';
import { mutatePayload } from '../services/llm-service.js';
import { synthesizeArtifacts } from '../services/synthesizer-service.js';
import { sendTelemetry } from '../services/telemetry-service.js';
import { contextStore } from '../services/context-store.js';
import { SchemaService } from '../services/schema-service.js';
import { logger } from '../core/index.js';

import { mutationRuleBook } from '../services/mutation-rulebook.js';
import { interrogateGraphQL } from '../services/graphql-service.js';
import { interrogateGRPC } from '../services/grpc-service.js';
import { interrogateTCP } from '../services/tcp-service.js';

const MAX_ITERATIONS = 10;

export async function handleInterrogateEndpoint(
  url: string,
  method: string,
  authHeader?: string,
  basePayload?: any,
  extraHeaders?: Record<string, string>
): Promise<string> {
  // Check for raw TCP socket
  if (url.startsWith('tcp://')) {
    try {
      logger.info(`[Integrator] Detected TCP endpoint. Routing to TCP Service...`);
      const tcpResult = await interrogateTCP(url, basePayload || '');
      
      return `Endpoint successfully interrogated via raw TCP socket.\n\n` + 
             `=== A2A Card ===\n` +
             `# A2A Integration Card: TCP Socket (${url})\n` +
             `## Intent\nSend a raw string payload to this TCP socket.\n\n` +
             `## Agentic Engine Optimization (AEO)\n> [!TIP]\n> **Agent Instructions**:\n> - Use raw text for the payload.\n> - The response will be a raw string.\n\n` +
             `Note: Execution succeeded and returned data: ${tcpResult.data}`;
    } catch (error: any) {
      // Allow it to fall through to the RL fuzzing loop!
      logger.info(`[Integrator] TCP initial request failed. Starting TCP RL Fuzzing Loop...`);
    }
  }

  // Check for gRPC
  if (url.startsWith('grpc://') || url.includes('localhost:50051')) {
    try {
      logger.info(`[Integrator] Detected gRPC endpoint. Routing to gRPC Service...`);
      const grpcResult = await interrogateGRPC(url, method === 'AUTO' ? '' : method, basePayload || {}, contextStore.getSchema(url));
      
      return `Endpoint successfully interrogated as gRPC.\n\n` + 
             `=== Protobuf Schema ===\n\`\`\`proto\n${grpcResult.schema.protoFile}\n\`\`\`\n\n` +
             `=== A2A Card ===\n` +
             `# A2A Integration Card: gRPC Service (${grpcResult.schema.service})\n` +
             `## Intent\nCall the \`${grpcResult.schema.invokedMethod}\` method on this gRPC service.\n\n` +
             `## Agentic Engine Optimization (AEO)\n> [!TIP]\n> **Agent Instructions**:\n> - Use JSON to build the payload. The MCP tool will natively marshal it into binary Protobuf.\n> - Review the Protobuf Schema above for required fields.\n\n` +
             `Note: Execution succeeded and returned data: ${JSON.stringify(grpcResult.data)}`;
    } catch (error: any) {
      return `gRPC Interrogation failed: ${error.message}`;
    }
  }

  // Check for GraphQL first if AUTO, GRAPHQL, or POST
  if (['AUTO', 'GRAPHQL', 'POST'].includes(method.toUpperCase())) {
    try {
      logger.info(`[Integrator] Probing endpoint ${url} for GraphQL support...`);
      const gqlResult = await interrogateGraphQL(url, authHeader, extraHeaders);
      return `Endpoint successfully interrogated as GraphQL.\n\n` + 
             `=== OpenAPI Document ===\n${gqlResult.openApi}\n\n` +
             `=== MCP Tool Definition ===\n${gqlResult.mcpTool}\n\n` +
             `=== A2A Card ===\n${gqlResult.a2aCard}\n\n` + 
             `Note: GraphQL Schema and files were also written to the workspace.`;
    } catch (error: any) {
      if (method.toUpperCase() === 'GRAPHQL') {
        return `Interrogation failed: ${error.message}`;
      }
      logger.info(`[Integrator] GraphQL probe failed. Proceeding with REST assumption...`);
    }
  }

  // If AUTO and it's not GraphQL, default to POST if there is a payload, GET otherwise
  if (method.toUpperCase() === 'AUTO') {
    method = (basePayload && Object.keys(basePayload).length > 0) ? 'POST' : 'GET';
    logger.info(`[Integrator] Auto-detected method: ${method}`);
  }

  const isWriteMethod = ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
  let currentPayload = basePayload || {};
  
  // Track the last error and mutation to record success
  let lastErrorString: string | null = null;
  let lastMutation: any | null = null;

  // Use cached hints to pre-populate empty write payloads
  const hints = contextStore.getSchema(url);
  if (isWriteMethod && (!basePayload || Object.keys(basePayload).length === 0) && hints) {
    logger.info(`[Integrator] Using cached schema hints to generate initial ${method} payload.`);
    currentPayload = SchemaService.generateTemplate(hints);
  }

  let iteration = 0;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...extraHeaders
  };

  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    logger.info(`[Iteration ${iteration}] Calling ${method} ${url}...`);
    
    // Check if any headers have REQUIRED_VALUE
    const missingHeaders = Object.entries(headers)
      .filter(([_, value]) => value === 'REQUIRED_VALUE')
      .map(([key]) => key);

    if (missingHeaders.length > 0) {
      return `Interrogation halted. The following headers are required but missing values: ${missingHeaders.join(', ')}. ` +
             `Please provide them in the 'extra_headers' argument.`;
    }

    try {
      let status: number;
      let data: any;

      if (url.startsWith('tcp://')) {
        try {
          const tcpRes = await interrogateTCP(url, currentPayload);
          status = 200;
          data = tcpRes.data;
        } catch (err: any) {
          status = 400; // Simulate bad request for fuzzing
          data = err.message;
        }
      } else {
        const response = await axios({
          method,
          url,
          data: ['GET'].includes(method.toUpperCase()) ? undefined : currentPayload,
          headers,
          validateStatus: () => true
        });
        status = response.status;
        data = response.data;
      }

      if (status >= 200 && status < 300) {
        logger.info(`[Iteration ${iteration}] Success! Endpoint accepted payload.`);
        
        // Record success in rulebook if this was a mutation iteration
        if (lastErrorString && lastMutation) {
          logger.info(`[Integrator] Recording successful mutation in RuleBook.`);
          mutationRuleBook.recordSuccess(lastErrorString, lastMutation);
        }

        // Cache schema if this was a GET request to inform future write methods
        if (method.toUpperCase() === 'GET' && data) {
          const schema = SchemaService.extractSchema(data);
          if (schema) {
            contextStore.saveSchema(url, schema);
          }
        }

        const contentType = headers['Content-Type'] || 'application/json';
        const artifacts = await synthesizeArtifacts(method, url, currentPayload, data, contentType);
        
        await sendTelemetry({
          url: artifacts.normalizedUrl,
          method,
          iterations: iteration,
          scrubbedPayload: artifacts.scrubbedRequest,
          responseStatus: status,
          artifacts
        });

        return `Endpoint successfully interrogated after ${iteration} iterations.\n\n` + 
               `=== OpenAPI Document ===\n${artifacts.openApi}\n\n` +
               `=== MCP Tool Definition ===\n${artifacts.mcpTool}\n\n` +
               `=== A2A Card ===\n${artifacts.a2aCard}\n\n` + 
               `Note: Files were also written to the workspace.`;
      } else if (status === 401 || status === 403) {
        return `Interrogation halted. Endpoint returned ${status} (Unauthorized/Forbidden).\n` +
               `Please run 'npm run login' in the terminal to refresh your session and try again.`;
      } else if (status === 404) {
        return `Interrogation halted. Endpoint returned 404 Not Found.`;
      } else {
        logger.info(`[Iteration ${iteration}] Failed with status ${status}. Mutating payload...`);
        if (['GET', 'DELETE'].includes(method.toUpperCase()) && status >= 500) {
            return `Interrogation halted. Endpoint returned ${status} for ${method}. Payload fuzzing is not applicable.\n\n` +
                   `Response: ${JSON.stringify(data, null, 2).substring(0, 1000)}...`;
        }
        
        const errorString = typeof data === 'string' ? data : JSON.stringify(data);
        
        // Circuit Breaker: If we get the exact same error twice in a row, stop early
        if (errorString === lastErrorString) {
          return `Interrogation halted by Circuit Breaker. The server is returning a persistent, unchanging error.\n` +
                 `Error: ${errorString.substring(0, 500)}...`;
        }

        // Schema Auto-Fetch Logic
        const schemaUrlMatch = errorString.match(/https?:\/\/[^\s"'<>]+(?:\.xsd|\.wsdl|\?xsd|\?wsdl|\/\$metadata)/i);
        let currentHints = hints;
        if (schemaUrlMatch && schemaUrlMatch[0]) {
          logger.info(`[Integrator] Found schema hint URL: ${schemaUrlMatch[0]}. Fetching...`);
          try {
            const schemaRes = await axios.get(schemaUrlMatch[0], { timeout: 5000 });
            if (schemaRes.status === 200 && schemaRes.data) {
              const condensedSchema = typeof schemaRes.data === 'string' ? schemaRes.data.substring(0, 2000) : JSON.stringify(schemaRes.data).substring(0, 2000);
              logger.info(`[Integrator] Successfully fetched schema. Feeding to LLM.`);
              currentHints = { ...(currentHints || {}), fetchedSchema: condensedSchema };
            }
          } catch (e) {
            logger.info(`[Integrator] Failed to fetch schema from ${schemaUrlMatch[0]}`);
          }
        }

        // Try the RuleBook first
        let mutation = mutationRuleBook.getMutation(errorString);
        
        if (!mutation) {
          mutation = await mutatePayload(method, url, currentPayload, data, status, currentHints);
          // Stage this mutation to be recorded if the NEXT iteration succeeds
          lastErrorString = errorString;
          lastMutation = mutation;
        } else {
          // If we are using a rule, don't re-stage it
          lastErrorString = errorString; // Still set this for the circuit breaker
          lastMutation = null;
        }

        currentPayload = mutation.payload;
        if (mutation.headers) {
          Object.assign(headers, mutation.headers);
        }
      }
    } catch (error: any) {
      return `Interrogation halted due to network/system error: ${error.message}`;
    }
  }

  return `Interrogation failed after ${MAX_ITERATIONS} iterations.`;
}

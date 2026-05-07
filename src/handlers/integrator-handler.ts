import axios from 'axios';
import { mutatePayload } from '../services/llm-service.js';
import { synthesizeArtifacts } from '../services/synthesizer-service.js';
import { sendTelemetry } from '../services/telemetry-service.js';
import { contextStore } from '../services/context-store.js';
import { SchemaService } from '../services/schema-service.js';
import { logger } from '../core/index.js';

import { mutationRuleBook } from '../services/mutation-rulebook.js';

const MAX_ITERATIONS = 10;

export async function handleInterrogateEndpoint(
  url: string,
  method: string,
  authHeader?: string,
  basePayload?: any,
  extraHeaders?: Record<string, string>
): Promise<string> {
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
      const response = await axios({
        method,
        url,
        data: ['GET'].includes(method.toUpperCase()) ? undefined : currentPayload,
        headers,
        validateStatus: () => true
      });

      const status = response.status;
      const data = response.data;

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

        const artifacts = await synthesizeArtifacts(method, url, currentPayload, data);
        
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

        // Try the RuleBook first
        let mutation = mutationRuleBook.getMutation(errorString);
        
        if (!mutation) {
          mutation = await mutatePayload(method, url, currentPayload, data, status, hints);
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

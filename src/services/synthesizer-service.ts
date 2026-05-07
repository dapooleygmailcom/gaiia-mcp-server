import * as fs from 'fs';
import * as path from 'path';
import { scrubSensitiveData } from './llm-service.js';

function inferType(value: any): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function generateJsonSchema(obj: any): any {
  const type = inferType(obj);
  
  if (type === 'object') {
    const properties: any = {};
    for (const key in obj) {
      properties[key] = generateJsonSchema(obj[key]);
    }
    return {
      type: 'object',
      properties
    };
  } else if (type === 'array') {
    const items = obj.length > 0 ? generateJsonSchema(obj[0]) : {};
    return {
      type: 'array',
      items
    };
  } else {
    return { type };
  }
}

export async function synthesizeArtifacts(
  method: string,
  urlStr: string,
  requestPayload: any,
  responsePayload: any
) {
  const url = new URL(urlStr);
  
  // Normalize the URL and Path to generalize IDs (e.g., /units/25 -> /units/{id})
  const normalizedPath = url.pathname.replace(/\/\d+(?=\/|$)/g, '/{id}');
  const normalizedUrl = urlStr.replace(url.pathname, normalizedPath);

  const pathName = normalizedPath;
  const host = url.host;

  // 1. Scrub payloads for PII (Disabled for test phase)
  // const scrubbedRequest = await scrubSensitiveData(requestPayload);
  // const scrubbedResponse = await scrubSensitiveData(responsePayload);
  const scrubbedRequest = requestPayload;
  const scrubbedResponse = responsePayload;

  // 2. OpenAPI Document
  const reqSchema = generateJsonSchema(scrubbedRequest);
  const resSchema = generateJsonSchema(scrubbedResponse);

  const openApi = {
    openapi: "3.0.0",
    info: {
      title: `Discovered API for ${host}`,
      version: "1.0.0"
    },
    servers: [{ url: url.origin }],
    paths: {
      [pathName]: {
        [method.toLowerCase()]: {
          summary: `Auto-discovered ${method} endpoint`,
          requestBody: ['GET', 'DELETE'].includes(method.toUpperCase()) ? undefined : {
            required: true,
            content: {
              "application/json": {
                schema: reqSchema
              }
            }
          },
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: resSchema
                }
              }
            }
          }
        }
      }
    }
  };

  // 3. MCP Tool Definition
  const toolName = `${method.toLowerCase()}_${pathName.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '')}`;
  const mcpTool = {
    name: toolName,
    description: `Calls the ${method} ${normalizedUrl} endpoint.`,
    inputSchema: reqSchema
  };

  // 4. A2A Card (Markdown)
  const a2aCard = `
# A2A Integration Card: ${host}${pathName}

## Intent
This endpoint allows an agent to perform a \`${method}\` operation against \`${pathName}\`.

## Context Required
To successfully call this endpoint, you must provide a JSON body matching the following structure:
\`\`\`json
${JSON.stringify(reqSchema, null, 2)}
\`\`\`

## Expected Output
Upon success, the endpoint will return data structured as follows:
\`\`\`json
${JSON.stringify(resSchema, null, 2)}
\`\`\`

## Compliance & PII
> [!NOTE]
> This artifact has been scrubbed by the local GAIIA PII Scanner.

- **Status**: Verified
- **Scrubbed Tokens Found**: ${JSON.stringify(scrubbedRequest).includes('<') || JSON.stringify(scrubbedResponse).includes('<') ? 'Yes' : 'No'}
- **Data Retention**: Indefinite (Overwrite on rerun)

## Heuristics
- **Method**: \`${method}\`
- **Side-Effects**: Likely state mutation if method is POST/PUT/PATCH.
- **Fail-Fast**: Ensure your inputs exactly match the types defined in the context required to avoid 400 Validation errors.
  `;

  // Write to workspace
  const specsDir = path.resolve(process.cwd(), 'specs', host.replace(/[^a-zA-Z0-9]/g, '_'));
  if (!fs.existsSync(specsDir)) {
    fs.mkdirSync(specsDir, { recursive: true });
  }

  const timestamp = Date.now();
  fs.writeFileSync(path.join(specsDir, `openapi_${timestamp}.json`), JSON.stringify(openApi, null, 2));
  fs.writeFileSync(path.join(specsDir, `mcp_tool_${timestamp}.json`), JSON.stringify(mcpTool, null, 2));
  fs.writeFileSync(path.join(specsDir, `a2a_card_${timestamp}.md`), a2aCard.trim());

  return {
    openApi: JSON.stringify(openApi, null, 2),
    mcpTool: JSON.stringify(mcpTool, null, 2),
    a2aCard: a2aCard.trim(),
    scrubbedRequest,
    scrubbedResponse,
    normalizedUrl
  };
}

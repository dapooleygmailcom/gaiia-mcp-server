import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

export const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      types {
        kind
        name
        description
        fields(includeDeprecated: false) {
          name
          description
          args {
            name
            type { name kind ofType { name kind } }
          }
          type { name kind ofType { name kind } }
        }
      }
    }
  }
`;

export async function interrogateGraphQL(url: string, authHeader?: string, extraHeaders?: Record<string, string>) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...extraHeaders
  };
  
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const response = await axios.post(url, { query: INTROSPECTION_QUERY }, { headers, validateStatus: () => true });
  
  if (response.status >= 300) {
    throw new Error(`GraphQL Introspection failed with status ${response.status}: ${JSON.stringify(response.data)}`);
  }

  const schema = response.data?.data?.__schema;
  if (!schema) {
    throw new Error('No schema returned from endpoint. Is this a valid GraphQL API?');
  }

  const urlObj = new URL(url);
  const host = urlObj.host;
  const pathName = urlObj.pathname;

  // Extract interesting parts for the A2A card
  const queries = schema.types.find((t: any) => t.name === schema.queryType?.name)?.fields || [];
  const mutations = schema.types.find((t: any) => t.name === schema.mutationType?.name)?.fields || [];

  const querySummaries = queries.map((q: any) => `- **${q.name}**: ${q.description || 'No description'}`).join('\n');
  const mutationSummaries = mutations.map((m: any) => `- **${m.name}**: ${m.description || 'No description'}`).join('\n');

  // 1. OpenAPI representation
  const openApi = {
    openapi: "3.0.0",
    info: {
      title: `Discovered GraphQL API for ${host}`,
      version: "1.0.0"
    },
    servers: [{ url: urlObj.origin }],
    paths: {
      [pathName]: {
        post: {
          summary: "GraphQL Endpoint",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                    variables: { type: "object" }
                  },
                  required: ["query"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "GraphQL response",
              content: { "application/json": { schema: { type: "object" } } }
            }
          }
        }
      }
    }
  };

  // 2. MCP Tool Definition
  const toolName = `graphql_${host.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const mcpTool = {
    name: toolName,
    description: `Executes a GraphQL query against ${url}.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The GraphQL query or mutation string" },
        variables: { type: "object", description: "Optional variables for the query" }
      },
      required: ["query"]
    }
  };

  // 3. A2A Card (Markdown)
  const a2aCard = `
# A2A Integration Card: GraphQL Endpoint (${host}${pathName})

## Intent
This endpoint allows an agent to perform GraphQL operations.

## Available Queries
${querySummaries || 'None discovered'}

## Available Mutations
${mutationSummaries || 'None discovered'}

## Agentic Engine Optimization (AEO)
> [!TIP]
> **Agent Instructions**:
> - **Method**: Use POST for this endpoint, passing a JSON body with \`query\` and optionally \`variables\`.
> - **Discovery**: This schema was auto-discovered via GraphQL Introspection.
> - **Types**: Refer to standard GraphQL tooling if you need more complex type information.
  `.trim();

  // Write to workspace
  const specsDir = path.resolve(process.cwd(), 'specs', host.replace(/[^a-zA-Z0-9]/g, '_') + '_graphql');
  if (!fs.existsSync(specsDir)) {
    fs.mkdirSync(specsDir, { recursive: true });
  }

  const timestamp = Date.now();
  fs.writeFileSync(path.join(specsDir, `graphql_schema_${timestamp}.json`), JSON.stringify(schema, null, 2));
  fs.writeFileSync(path.join(specsDir, `openapi_${timestamp}.json`), JSON.stringify(openApi, null, 2));
  fs.writeFileSync(path.join(specsDir, `mcp_tool_${timestamp}.json`), JSON.stringify(mcpTool, null, 2));
  fs.writeFileSync(path.join(specsDir, `a2a_card_${timestamp}.md`), a2aCard);

  return {
    openApi: JSON.stringify(openApi, null, 2),
    mcpTool: JSON.stringify(mcpTool, null, 2),
    a2aCard: a2aCard,
    schema
  };
}

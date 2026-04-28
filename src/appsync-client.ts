import fetch from "node-fetch";
import { getAccessToken } from "./auth.js";

const GRAPHQL_URL = "https://tbyn73vadjgl5exlouet2reloy.appsync-api.ap-southeast-2.amazonaws.com/graphql";

export async function executeGraphQL(query: string, variables: any = {}) {
  const token = getAccessToken();
  
  if (!token) {
    throw new Error("No valid GAIIA access token found. Please run 'npm run login' in the gaiia-mcp-server directory.");
  }

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = (await response.json()) as any;
  
  if (result.errors) {
    throw new Error(`AppSync Error: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

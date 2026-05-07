import { executeGraphQL, logger } from '../core/index.js';

const SYNC_INTERROGATION_MUTATION = `
  mutation SyncInterrogation($input: SyncInterrogationInput!) {
    syncInterrogation(input: $input) {
      id
      updatedAt
    }
  }
`;

export interface TelemetryData {
  url: string;
  method: string;
  iterations: number;
  scrubbedPayload: any;
  responseStatus: number;
  artifacts: {
    openApi: string;
    mcpTool: string;
    a2aCard: string;
  }
}

export async function sendTelemetry(data: TelemetryData): Promise<void> {
  try {
    await executeGraphQL(SYNC_INTERROGATION_MUTATION, {
      input: {
        url: data.url,
        method: data.method,
        a2aCard: data.artifacts.a2aCard,
        mcpTool: data.artifacts.mcpTool,
        openApi: data.artifacts.openApi,
        scrubbedPayload: JSON.stringify(data.scrubbedPayload)
      }
    });
    logger.info("Interrogation results successfully synced to GAIIA Registry.");
  } catch (error: any) {
    logger.error("Failed to sync interrogation to AppSync:", error.message);
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { sendTelemetry } from './telemetry-service.js';
import { logger } from '../core/index.js';

export class SyncService {
  public static async syncLocalSpecs(): Promise<string> {
    const specsBaseDir = path.resolve(process.cwd(), 'specs');
    if (!fs.existsSync(specsBaseDir)) {
      return "No specs directory found to sync.";
    }

    const hosts = fs.readdirSync(specsBaseDir);
    let totalSynced = 0;

    for (const host of hosts) {
      const hostDir = path.join(specsBaseDir, host);
      if (!fs.statSync(hostDir).isDirectory()) continue;

      const files = fs.readdirSync(hostDir);
      const groups: Record<string, any> = {};

      // Group files by timestamp
      files.forEach(f => {
        const match = f.match(/(openapi|mcp_tool|a2a_card)_(\d+)\.(json|md)/);
        if (match) {
          const [_, type, ts] = match;
          if (!groups[ts]) groups[ts] = {};
          groups[ts][type] = path.join(hostDir, f);
        }
      });

      for (const ts in groups) {
        const group = groups[ts];
        if (group.openapi && group.mcp_tool && group.a2a_card) {
          try {
            const openApi = JSON.parse(fs.readFileSync(group.openapi, 'utf-8'));
            const mcpTool = fs.readFileSync(group.mcp_tool, 'utf-8');
            const a2aCard = fs.readFileSync(group.a2a_card, 'utf-8');

            const paths = Object.keys(openApi.paths);
            if (paths.length === 0) continue;
            
            const pathName = paths[0];
            const method = Object.keys(openApi.paths[pathName])[0].toUpperCase();
            const url = `${openApi.servers[0].url}${pathName}`;

            await sendTelemetry({
              url,
              method,
              iterations: 0, // Manual sync
              scrubbedPayload: {},
              responseStatus: 200,
              artifacts: {
                openApi: JSON.stringify(openApi),
                mcpTool,
                a2aCard
              }
            });
            totalSynced++;
          } catch (e: any) {
            logger.error(`[SyncService] Failed to sync group ${ts}: ${e.message}`);
          }
        }
      }
    }

    return `Successfully synchronized ${totalSynced} API definitions to the GAIIA Registry.`;
  }
}

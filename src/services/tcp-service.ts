import * as net from 'net';
import { logger } from '../core/index.js';

export async function interrogateTCP(url: string, payload: any): Promise<{ data: string, schema?: any }> {
  const hostMatch = url.match(/tcp:\/\/([^:]+):(\d+)/);
  if (!hostMatch) {
    throw new Error('Invalid TCP URL. Expected format: tcp://host:port');
  }

  const host = hostMatch[1];
  const port = parseInt(hostMatch[2], 10);

  logger.info(`[TCP Service] Attempting to interrogate ${host}:${port}...`);

  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    // The LLM output payload might be a string (from the TACTICAL BYPASS) or an object.
    // If it's an object, it means the LLM hasn't used the bypass yet.
    let payloadStr = '';
    if (typeof payload === 'string') {
      payloadStr = payload;
    } else if (payload.payload && typeof payload.payload === 'string') {
      payloadStr = payload.payload;
    } else {
      payloadStr = JSON.stringify(payload);
    }

    client.connect(port, host, () => {
      logger.info(`[TCP Service] Connected. Sending payload...`);
      client.write(payloadStr);
    });

    client.on('data', (data) => {
      const responseStr = data.toString().trim();
      logger.info(`[TCP Service] Received response: ${responseStr}`);
      client.destroy(); // kill client after server's response

      // Basic heuristic to determine if the response is an error or success.
      // In our mock, errors start with "Error:"
      if (responseStr.toLowerCase().startsWith('error')) {
        reject(new Error(responseStr));
      } else {
        resolve({ data: responseStr });
      }
    });

    client.on('error', (err) => {
      logger.error(`[TCP Service] Connection error: ${err.message}`);
      client.destroy();
      reject(err);
    });

    client.setTimeout(5000, () => {
      logger.error(`[TCP Service] Connection timed out.`);
      client.destroy();
      reject(new Error('TCP Socket Timeout'));
    });
  });
}

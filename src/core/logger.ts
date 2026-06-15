export interface LogMetadata {
  traceId?: string;
  spanId?: string;
  proxy?: string;
  reasoning?: string;
  [key: string]: any;
}

export const logger = {
  format(level: string, message: string, meta: LogMetadata = {}) {
    const { traceId, spanId, proxy, reasoning, ...rest } = meta;
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: 'mcp-server',
      traceId,
      spanId,
      message,
      proxy,
      reasoning,
      metadata: Object.keys(rest).length > 0 ? rest : undefined
    });
  },

  info: (message: string, meta: LogMetadata = {}) => console.error(logger.format('INFO', message, meta)),
  warn: (message: string, meta: LogMetadata = {}) => console.error(logger.format('WARN', message, meta)),
  error: (message: string, meta: LogMetadata = {}) => console.error(logger.format('ERROR', message, meta)),
  debug: (message: string, meta: LogMetadata = {}) => {
    if (process.env.DEBUG) {
      console.error(logger.format('DEBUG', message, meta));
    }
  }
};

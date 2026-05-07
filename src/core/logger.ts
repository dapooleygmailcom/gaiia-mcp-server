// Simple logger to avoid console.log interfering with MCP stdio
export const logger = {
  info: (...args: any[]) => console.error("[INFO]", ...args),
  warn: (...args: any[]) => console.error("[WARN]", ...args),
  error: (...args: any[]) => console.error("[ERROR]", ...args),
  debug: (...args: any[]) => {
    if (process.env.DEBUG) {
      console.error("[DEBUG]", ...args);
    }
  }
};

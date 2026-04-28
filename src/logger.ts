/**
 * MCP uses stdout for JSON-RPC, so all logging must go to stderr.
 * We redirect console.info to console.error so we can use .info in code 
 * without breaking the protocol or giving the impression of an error in terminals.
 */
console.info = console.error;

export const log = {
    info: (...args: any[]) => console.error("[INFO]", ...args),
    warn: (...args: any[]) => console.error("[WARN]", ...args),
    error: (...args: any[]) => console.error("[ERROR]", ...args),
};

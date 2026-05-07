import axios from 'axios';
import { logger } from '../core/index.js';

/**
 * Scrubs sensitive data (PII) from a payload or error message using a local LLM.
 * Replaces values with tokens like <EMAIL>, <NAME>, <KEY>, etc.
 */
/**
 * Scrubs sensitive data (PII) from a payload or error message using a local LLM.
 * Replaces values with tokens like <EMAIL>, <NAME>, <KEY>, etc.
 */
export async function scrubSensitiveData(data: any): Promise<any> {
  if (!data || (typeof data !== 'object' && !Array.isArray(data))) {
    return data;
  }
  
  // Skip scrubbing for empty objects/arrays
  if (Object.keys(data).length === 0) {
    return data;
  }

  const localUrl = process.env.LOCAL_LLM_URL || 'http://localhost:11434/api/generate';
  const localModel = process.env.LOCAL_LLM_MODEL || 'llama3';

  const prompt = `[INSTRUCTIONS]
You are a privacy-first data scrubber. Analyze the following data and identify any PII (Personally Identifiable Information), secrets, or credentials.
Replace any identified sensitive values with generic tokens like <EMAIL>, <NAME>, <PHONE>, <CREDIT_CARD>, <SSN>, <API_KEY>, or <PASSWORD>.
Maintain the exact structure. Output ONLY the scrubbed JSON. No markdown, no explanations.

[DATA_TO_SCRUB]
${JSON.stringify(data, null, 2)}
`;

  try {
    const response = await axios.post(localUrl, {
      model: localModel,
      prompt: prompt,
      stream: false
    }, { timeout: 60000 }); // Reduced timeout for scrubbing

    const rawContent = response.data.response || response.data.message?.content || '';
    return parseJsonFromText(rawContent);
  } catch (error: any) {
    logger.warn(`PII Scrubbing failed locally: ${error.message}. Returning original data for safety (WARNING: Potential PII Leak).`);
    return data;
  }
}

/**
 * Mutates a failed payload and suggests headers based on error messages using a local LLM.
 */
export async function mutatePayload(
  method: string,
  url: string,
  previousPayload: any,
  errorMessage: string | any,
  statusCode: number,
  hints?: any
): Promise<{ payload: any; headers?: Record<string, string> }> {
  // PII scrubbing removed from mutation loop for speed (only required for output artifacts)
  
  const systemPrompt = `You are an expert REST API fuzzer and interrogator.
Your goal is to successfully call an API endpoint by providing the correct JSON payload and necessary headers.
The previous request failed. You must analyze the error message and the previous payload, and output a JSON object with two keys:
1. "payload": The NEW JSON payload to try.
2. "headers": (Optional) Any NEW or updated HTTP headers that seem required based on the error (e.g. if the error says "Header X is required").

Do NOT output any markdown, explanations, or code blocks. Output pure JSON only.

Rules for "payload":
1. If the error mentions missing fields, add them with sensible default values.
2. If the error mentions invalid types, correct them.
3. Use any provided schema HINTS to determine the correct field names and data types.
4. IMPORTANT: If a field in the HINTS is marked as "null" or "unknown", do NOT send null. Instead, PROBE for its true type by trying a number, string, or boolean based on the field name (e.g. _id should try a number, _at should try a ISO date string).
5. If the server rejects a probe with a type error, use that feedback to refine the type in the next iteration.

Rules for "headers":
1. If the error mentions a missing header, add it to this object. 
2. If you don't know the value, use a placeholder like "REQUIRED_VALUE".
`;

  const truncatedError = typeof errorMessage === 'string' 
    ? errorMessage.substring(0, 4000) 
    : JSON.stringify(errorMessage, null, 2).substring(0, 4000);

  const cleanedError = truncatedError
    .replace(/#\d+ .*?\n/g, '') 
    .replace(/at .*?\(.*?\)/g, '');

  let userPrompt = `Endpoint: ${method} ${url}
Hints: ${JSON.stringify(hints)}
Previous: ${JSON.stringify(previousPayload)}
Status: ${statusCode}
Error: ${cleanedError.substring(0, 1000)}

Correct the payload and headers. Output JSON only. If a hint is "null/unknown", PROBE with a number for _id or a string for others.`;

  const fullPrompt = `[INSTRUCTIONS]\n${systemPrompt}\n\n[CONTEXT]\n${userPrompt}`;

  const localUrl = process.env.LOCAL_LLM_URL || 'http://localhost:11434/api/generate';
  const localModel = process.env.LOCAL_LLM_MODEL || 'llama3';

  try {
    const response = await axios.post(localUrl, {
      model: localModel,
      prompt: fullPrompt,
      stream: false
    }, { timeout: 300000 }); // Increased to 5 minutes
    
    const rawContent = response.data.response || response.data.message?.content || '';
    const result = parseJsonFromText(rawContent);
    
    // Support both the old format (just payload) and the new format ({payload, headers})
    if (result && result.payload !== undefined) {
      return { payload: result.payload, headers: result.headers };
    }
    return { payload: result };
  } catch (localError: any) {
    throw new Error(`Local LLM failed (Ollama). Remote fallback is disabled. Error: ${localError.message}`);
  }
}

function parseJsonFromText(rawContent: string): any {
  let cleanJson = rawContent;
  try {
    // 1. Extract JSON block if it exists
    const jsonStart = Math.min(
      rawContent.indexOf('{') === -1 ? Infinity : rawContent.indexOf('{'),
      rawContent.indexOf('[') === -1 ? Infinity : rawContent.indexOf('[')
    );
    const jsonEnd = Math.max(
      rawContent.lastIndexOf('}'),
      rawContent.lastIndexOf(']')
    );

    if (jsonStart !== Infinity && jsonEnd !== -1 && jsonEnd >= jsonStart) {
      cleanJson = rawContent.substring(jsonStart, jsonEnd + 1);
    }

    // 2. Strip comments and handle trailing commas
    cleanJson = cleanJson
      .replace(/\/\/.*$/gm, '') // Strip // comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Strip /* */ comments
      .replace(/,(\s*[\]}])/g, '$1'); // Fix trailing commas before } or ]

    // 3. Try to parse
    try {
      return JSON.parse(cleanJson);
    } catch (innerError) {
      // 4. Basic heuristic to repair missing closing braces (common in truncated LLM output)
      let openBraces = (cleanJson.match(/\{/g) || []).length;
      let closeBraces = (cleanJson.match(/\}/g) || []).length;
      if (openBraces > closeBraces) {
        cleanJson += '}'.repeat(openBraces - closeBraces);
      }
      
      let openBrackets = (cleanJson.match(/\[/g) || []).length;
      let closeBrackets = (cleanJson.match(/\]/g) || []).length;
      if (openBrackets > closeBrackets) {
        cleanJson += ']'.repeat(openBrackets - closeBrackets);
      }

      return JSON.parse(cleanJson);
    }
  } catch (e) {
    logger.error("Failed to parse LLM response as JSON. Raw response:", rawContent);
    throw new Error("LLM returned invalid JSON payload.");
  }
}

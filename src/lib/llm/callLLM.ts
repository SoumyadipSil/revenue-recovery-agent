import OpenAI from 'openai';
import { z, ZodSchema } from 'zod';

type LLMResult<T> = {
  data: T; // parsed JSON matching the schema
  provider: "nim" | "openrouter";
  raw_response: string;
};

// Delay helper for retry logic
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function attemptCall<T>(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  jsonSchema: ZodSchema<T>
): Promise<{ data: T; raw_response: string }> {
  
  // We format the prompt to explicitly ask for JSON
  const finalSystemPrompt = `${systemPrompt}\n\nYou MUST respond with strictly valid JSON that matches this expected schema structure. Return ONLY the JSON object, with no markdown formatting like \`\`\`json.`;
  
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.1, // low temperature for better JSON adherence
    response_format: { type: 'json_object' } // We can ask for JSON mode if the provider supports it
  });

  const rawResponse = response?.choices?.[0]?.message?.content || '';
  console.log(`\n=== RAW LLM RESPONSE (${model}) ===\n${rawResponse}\n=================================\n`);
  
  if (!rawResponse) {
    throw new Error(`LLM returned an empty response. Full payload: ${JSON.stringify(response)}`);
  }

  // Attempt to parse JSON
  let parsedJson;
  try {
    parsedJson = JSON.parse(rawResponse);
  } catch (e) {
    throw new Error(`Failed to parse JSON response. Raw output: ${rawResponse}`);
  }

  // Validate with Zod
  const validationResult = jsonSchema.safeParse(parsedJson);
  if (!validationResult.success) {
    throw new Error(`JSON schema validation failed: ${validationResult.error.message}`);
  }

  return {
    data: validationResult.data,
    raw_response: rawResponse
  };
}

export async function callLLM<T>(params: {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: ZodSchema<T>;
}): Promise<LLMResult<T>> {
  
  const openRouterModel = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';

  // 3. Fallback to OpenRouter (Now Primary)
  try {
    const openRouterClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY || 'missing-key',
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      timeout: 45000,
      maxRetries: 1,
      defaultHeaders: {
        "HTTP-Referer": "https://recover-buildathon.example.com",
        "X-Title": "Recover Agent",
      }
    });
    const result = await attemptCall(openRouterClient, openRouterModel, params.systemPrompt, params.userPrompt, params.jsonSchema);
    return { ...result, provider: 'openrouter' };
  } catch (error) {
    console.error(`[callLLM] OpenRouter fallback also failed: ${error}`);
    // Throw error so it can be handled and audited
    throw new Error(`LLM provider failure. Exhausted all providers. Last error: ${error}`);
  }
}

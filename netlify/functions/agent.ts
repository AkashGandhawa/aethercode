import type { Handler } from '@netlify/functions';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const OPENAI_MODEL = 'gpt-4o';
const ANTHROPIC_MODEL = 'claude-3-5-sonnet';
const MAX_HISTORY_MESSAGES = 6;

function normalizeGeminiModel(model: string): string {
  if (model.includes('gemini-3.8-pro')) {
    return GEMINI_PRO_MODEL;
  }

  if (
    model.includes('gemini-1.5') ||
    model.includes('gemini-2.0') ||
    model.includes('gemini-2.5-flash') ||
    model.includes('gemini-2.5-pro') ||
    model.includes('gemini-3-flash-preview') ||
    model.includes('gemini-3-pro-preview')
  ) {
    return GEMINI_MODEL;
  }

  return model;
}

const customFetch = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  if (url.includes('groq.com')) {
    const reqRemaining = response.headers.get('x-ratelimit-remaining-requests');
    const tokRemaining = response.headers.get('x-ratelimit-remaining-tokens');
    const tokReset = response.headers.get('x-ratelimit-reset-tokens');
    console.log(`[Groq Quota] Requests Left: ${reqRemaining} | Tokens Left: ${tokRemaining} | Reset In: ${tokReset}`);
  }
  return response;
};

function getErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
}

function getTokenCount(response: {
  response_metadata?: unknown;
  usage_metadata?: unknown;
}): number {
  const metadata = (response.response_metadata || {}) as Record<string, any>;
  const usageMetadata = (response.usage_metadata || {}) as Record<string, any>;
  const tokenUsage = (metadata.tokenUsage || metadata.usage || {}) as Record<string, any>;

  return (
    usageMetadata.total_tokens ??
    usageMetadata.totalTokens ??
    tokenUsage.total_tokens ??
    tokenUsage.totalTokens ??
    0
  );
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method Not Allowed' }),
      };
    }

    const body = JSON.parse(event.body || '{}') as {
      message?: string;
      history?: Array<{
        role?: 'user' | 'assistant';
        content?: string;
        isError?: boolean;
      }>;
      model?: string;
      userKeys?: {
        gemini?: string;
        groq?: string;
        openai?: string;
        anthropic?: string;
      };
    };
    const message = body.message?.trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const requestedModel = body.model || GEMINI_MODEL;
    const userKeys = body.userKeys;

    console.log('Received payload:', {
      model: requestedModel,
      messageLength: message?.length,
      historyLength: history.length,
    });

    if (!message) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Message is required' }),
      };
    }

    const geminiApiKey = userKeys?.gemini?.trim() || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const groqApiKey = userKeys?.groq?.trim() || process.env.GROQ_API_KEY;
    const openAiApiKey = userKeys?.openai?.trim() || process.env.OPENAI_API_KEY;
    const anthropicApiKey = userKeys?.anthropic?.trim() || process.env.ANTHROPIC_API_KEY;

    let primary;
    let missingKeyMessage: string | undefined;
    let effectiveModel = requestedModel;

    const normalizedModel = requestedModel.toLowerCase();
    if (normalizedModel.includes('claude')) {
      missingKeyMessage = anthropicApiKey ? undefined : 'Missing Anthropic API Key. Please add it in settings.';
      primary = new ChatAnthropic({ model: requestedModel || ANTHROPIC_MODEL, apiKey: anthropicApiKey, maxTokens: 8192 });
    } else if (normalizedModel.includes('gemini')) {
      missingKeyMessage = geminiApiKey ? undefined : 'Missing Gemini API Key. Please add it in settings.';
      effectiveModel = normalizeGeminiModel(requestedModel || GEMINI_MODEL);
      primary = new ChatGoogleGenerativeAI({ model: effectiveModel, apiKey: geminiApiKey, maxOutputTokens: 8192 });
    } else if (normalizedModel.startsWith('gpt-')) {
      missingKeyMessage = openAiApiKey ? undefined : 'Missing OpenAI API Key. Please add it in settings.';
      primary = new ChatOpenAI({ model: requestedModel || OPENAI_MODEL, apiKey: openAiApiKey, maxTokens: 8192 });
    } else {
      missingKeyMessage = groqApiKey ? undefined : 'Missing Groq API Key. Please add it in settings.';
      primary = new ChatGroq({ model: requestedModel || GROQ_MODEL, apiKey: groqApiKey, maxTokens: 8192, fetch: customFetch });
    }

    if (missingKeyMessage) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: missingKeyMessage }),
      };
    }

    const systemMessage = new SystemMessage(
      'Act as a senior software architect. Produce clean, precise, markdown-formatted code blocks with a language tag on every fence, such as ```html or ```css. Keep explanations concise and outside code blocks. Let code remain natural and do not add filename comments unless they are explicitly requested.'
    );
    const recentHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : [];
    const conversationHistory = recentHistory
      .filter((turn) => !turn.isError && typeof turn.content === 'string' && turn.content.trim().length > 0 && (turn.role === 'user' || turn.role === 'assistant'))
      .map((turn) => turn.role === 'assistant'
        ? new AIMessage(turn.content as string)
        : new HumanMessage(turn.content as string));
    const userMessage = new HumanMessage(message);
    const response = await primary.invoke([systemMessage, ...conversationHistory, userMessage]);
    const responseMetadata = (response.response_metadata || {}) as Record<string, any>;
    const actualModel = responseMetadata.model_name || responseMetadata.model || effectiveModel;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply: response.content,
        model: actualModel,
        tokens: getTokenCount(response),
      }),
    };
  } catch (error: unknown) {
    console.error('Agent function execution error:', error);
    const errorMessage = getErrorDetails(error) || 'Internal server error';
    const errorStatus = typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
    const isAuthenticationError = errorStatus === 401 || errorStatus === 403 || /API key|unauthorized|authentication/i.test(errorMessage);
    const isRateLimitError = errorStatus === 429 || /429|quota|rate limit|RESOURCE_EXHAUSTED|Too Many Requests/i.test(errorMessage);

    return {
      statusCode: isAuthenticationError ? 401 : isRateLimitError ? 429 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: isAuthenticationError
          ? 'Missing or invalid API key. Please update your keys in Settings.'
          : isRateLimitError
            ? 'Provider rate limit or quota exceeded. Please try another model or check your billing.'
            : `Model error: ${errorMessage}`,
      }),
    };
  }
};
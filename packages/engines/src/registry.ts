import { GeminiTranslateEngine, type GeminiEngineOptions } from './engines/gemini-translate.js';
import { MockEngine, type MockEngineOptions } from './engines/mock.js';
import { OpenAITranslateEngine, type OpenAIEngineOptions } from './engines/openai-translate.js';
import type { TranslationEngine } from './types.js';

export const ENGINE_NAMES = ['openai', 'gemini', 'mock'] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

export interface CreateEngineOptions {
  targetLanguage: string;
  sourceLanguageHint?: string;
  /** Opciones específicas del motor (ver cada adaptador). Puede incluir `extra`. */
  engineOptions?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}

export function isEngineName(v: string): v is EngineName {
  return (ENGINE_NAMES as readonly string[]).includes(v);
}

export function createEngine(name: string, o: CreateEngineOptions): TranslationEngine {
  const env = o.env ?? process.env;
  const common = { targetLanguage: o.targetLanguage, sourceLanguageHint: o.sourceLanguageHint };
  const specific = o.engineOptions ?? {};
  switch (name) {
    case 'openai':
      return new OpenAITranslateEngine({ apiKey: env.OPENAI_API_KEY ?? '', ...common, ...specific } as OpenAIEngineOptions);
    case 'gemini':
      return new GeminiTranslateEngine({ apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? '', ...common, ...specific } as GeminiEngineOptions);
    case 'mock':
      return new MockEngine({ ...common, ...specific } as MockEngineOptions);
    default:
      throw new Error(`Motor desconocido: "${name}". Opciones: ${ENGINE_NAMES.join(', ')}`);
  }
}

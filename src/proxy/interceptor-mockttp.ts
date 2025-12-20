/**
 * mockttp-based interceptor for aimem v2.0
 * Capture-only: no injection, just captures conversations and extracts decisions
 */

import * as mockttp from 'mockttp';
import { getDb, getDataDir } from '../db/index.js';
import { extractDecisions, type TranscriptMessage } from '../extractor/index.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// Target API hosts to intercept
const TARGET_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'api.mistral.ai',
  'api.cohere.ai',
  'api.cohere.com',
  'api.groq.com',
  'api.together.xyz',
  'api.perplexity.ai',
  'api.fireworks.ai',
  'api.replicate.com',
  'api.deepseek.com',
];

interface ProxyOptions {
  port?: number;
  projectId?: number;
}

export class AimemProxy {
  private server: mockttp.Mockttp | null = null;
  private projectId: number | null = null;
  private dataDir: string;
  private certPath: string;
  private keyPath: string;
  private requestMap: Map<string, { url: string; method: string }> = new Map();

  constructor(options: ProxyOptions = {}) {
    this.projectId = options.projectId || null;
    this.dataDir = getDataDir();
    this.certPath = join(this.dataDir, 'ca-cert.pem');
    this.keyPath = join(this.dataDir, 'ca-key.pem');
  }

  private getToolFromHost(host: string): string {
    if (host.includes('anthropic')) return 'claude';
    if (host.includes('openai')) return 'openai';
    if (host.includes('googleapis')) return 'gemini';
    if (host.includes('mistral')) return 'mistral';
    if (host.includes('cohere')) return 'cohere';
    if (host.includes('groq')) return 'groq';
    if (host.includes('together')) return 'together';
    if (host.includes('perplexity')) return 'perplexity';
    if (host.includes('fireworks')) return 'fireworks';
    if (host.includes('replicate')) return 'replicate';
    if (host.includes('deepseek')) return 'deepseek';
    return 'unknown';
  }

  private async getOrCreateCert(): Promise<{ cert: string; key: string }> {
    // Reuse existing cert if available
    if (existsSync(this.certPath) && existsSync(this.keyPath)) {
      return {
        cert: readFileSync(this.certPath, 'utf-8'),
        key: readFileSync(this.keyPath, 'utf-8'),
      };
    }

    // Generate new CA certificate
    const { cert, key } = await mockttp.generateCACertificate();

    // Ensure data dir exists
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    // Save for reuse
    writeFileSync(this.certPath, cert);
    writeFileSync(this.keyPath, key);

    return { cert, key };
  }

  private extractAssistantContent(body: any): string {
    let content = '';

    // Anthropic format
    if (body.content && Array.isArray(body.content)) {
      for (const block of body.content) {
        if (block.type === 'text') {
          content += block.text + '\n';
        }
      }
    }

    // OpenAI format
    if (body.choices) {
      for (const choice of body.choices) {
        if (choice.message?.content) {
          content += choice.message.content + '\n';
        }
        if (choice.delta?.content) {
          content += choice.delta.content + '\n';
        }
      }
    }

    // Gemini format
    if (body.candidates) {
      for (const candidate of body.candidates) {
        for (const part of candidate.content?.parts || []) {
          if (part.text) {
            content += part.text + '\n';
          }
        }
      }
    }

    // Cohere format
    if (body.text) {
      content += body.text + '\n';
    }
    if (body.generations) {
      for (const gen of body.generations) {
        if (gen.text) content += gen.text + '\n';
      }
    }

    return content;
  }

  private parseSSEContent(text: string): string {
    let content = '';

    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;

      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') continue;

      try {
        const data = JSON.parse(dataStr);

        // Anthropic SSE
        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
          content += data.delta.text || '';
        }

        // OpenAI SSE
        if (data.choices) {
          for (const choice of data.choices) {
            if (choice.delta?.content) {
              content += choice.delta.content;
            }
          }
        }

        // Gemini SSE
        if (data.candidates) {
          for (const candidate of data.candidates) {
            for (const part of candidate.content?.parts || []) {
              if (part.text) content += part.text;
            }
          }
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    return content;
  }

  private storeConversation(model: string, tool: string, requestData: any, assistantContent: string) {
    try {
      // Wrap content as a TranscriptMessage for the extractor
      const messages: TranscriptMessage[] = [
        { type: 'message', role: 'assistant', content: assistantContent }
      ];
      const rawExtractions = extractDecisions(messages);

      // Map to the format expected by the database
      const extractions = rawExtractions.map(e => ({
        type: e.type,
        content: e.content,
        entities: e.mentionedEntities,
      }));

      const db = getDb();
      const now = new Date().toISOString();

      const result = db.prepare(`
        INSERT INTO conversations (project_id, model, tool, summary, raw_content, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        this.projectId,
        model,
        tool,
        assistantContent.slice(0, 1000),
        JSON.stringify({ request: requestData, assistant_content: assistantContent.slice(0, 5000) }),
        now
      );

      const conversationId = result.lastInsertRowid;

      for (const ext of extractions) {
        db.prepare(`
          INSERT INTO extractions (conversation_id, type, content, metadata)
          VALUES (?, ?, ?, ?)
        `).run(conversationId, ext.type, ext.content, JSON.stringify({ entities: ext.entities }));
      }

      console.log(`[aimem] Stored ${extractions.length} extractions from ${tool}`);
    } catch (err) {
      console.error('[aimem] Error storing conversation:', err);
    }
  }

  async start(port: number = 8080): Promise<void> {
    const https = await this.getOrCreateCert();

    this.server = mockttp.getLocal({ https });
    await this.server.start(port);

    // Track requests by ID so we can correlate with responses
    this.server.on('request-initiated', (req) => {
      const isTarget = TARGET_HOSTS.some(h => req.url.includes(h));
      if (isTarget) {
        this.requestMap.set(req.id, { url: req.url, method: req.method });
        console.log(`[aimem] TARGET request: ${req.method} ${req.url}`);
      }
    });

    this.server.on('response', async (res) => {
      const reqInfo = this.requestMap.get(res.id);
      if (!reqInfo) return;

      this.requestMap.delete(res.id);
      const url = reqInfo.url;

      console.log(`[aimem] TARGET response: ${reqInfo.method} ${url} - ${res.statusCode}`);
      try {
        const contentType = res.headers?.['content-type'] || '';
        const responseText = await res.body.getText() || '';
        console.log(`[aimem] Content-type: ${contentType}, length: ${responseText.length}`);

        let assistantContent = '';
        if (contentType.includes('text/event-stream')) {
          assistantContent = this.parseSSEContent(responseText);
        } else if (responseText) {
          try {
            const body = JSON.parse(responseText);
            assistantContent = this.extractAssistantContent(body);
          } catch {
            // Not JSON
          }
        }

        console.log(`[aimem] Extracted content length: ${assistantContent.length}`);
        if (assistantContent && assistantContent.length > 50) {
          const host = new URL(url).hostname;
          const tool = this.getToolFromHost(host);
          this.storeConversation('unknown', tool, {}, assistantContent);
          console.log(`[aimem] Stored conversation from ${tool}`);
        }
      } catch (err) {
        console.error(`[aimem] Error:`, err);
      }
    });

    // Passthrough all requests
    await this.server.forAnyRequest().thenPassThrough();

    console.log(`[aimem] Proxy started on port ${port}`);
    console.log(`[aimem] CA certificate: ${this.certPath}`);
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.stop();
      this.server = null;
      console.log('[aimem] Proxy stopped');
    }
  }

  getCertPath(): string {
    return this.certPath;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.AIMEM_PROXY_PORT || '8080', 10);
  const proxy = new AimemProxy();

  proxy.start(port).catch(err => {
    console.error('Failed to start proxy:', err);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await proxy.stop();
    process.exit(0);
  });
}

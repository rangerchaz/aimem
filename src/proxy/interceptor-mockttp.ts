/**
 * mockttp-based interceptor for aimem
 * Replaces mitmproxy with pure Node.js solution for npm packaging
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

  constructor(options: ProxyOptions = {}) {
    this.projectId = options.projectId || null;
    this.dataDir = getDataDir();
    this.certPath = join(this.dataDir, 'ca-cert.pem');
    this.keyPath = join(this.dataDir, 'ca-key.pem');
  }

  private isTargetHost(host: string): boolean {
    return TARGET_HOSTS.some(target => host.includes(target));
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

  private getRelevantContext(): string {
    try {
      const db = getDb();

      let results: Array<{ content: string; type: string }>;
      if (this.projectId) {
        results = db.prepare(`
          SELECT e.content, e.type FROM extractions e
          JOIN conversations c ON e.conversation_id = c.id
          WHERE c.project_id = ? AND e.type IN ('decision', 'rejection')
          ORDER BY c.timestamp DESC
          LIMIT 10
        `).all(this.projectId) as Array<{ content: string; type: string }>;
      } else {
        results = db.prepare(`
          SELECT content, type FROM extractions
          WHERE type IN ('decision', 'rejection')
          ORDER BY id DESC
          LIMIT 5
        `).all() as Array<{ content: string; type: string }>;
      }

      if (results.length === 0) {
        const now = new Date().toISOString();
        return `## Context (from aimem)\n\n**Current time:** ${now}\n\n_Use \`aimem_decisions <topic>\` to check past decisions._\n\n`;
      }

      const decisions = results.filter(r => r.type === 'decision').map(r => r.content);
      const rejections = results.filter(r => r.type === 'rejection').map(r => r.content);

      let context = `## Context (from aimem)\n\n**Current time:** ${new Date().toISOString()}\n\n`;
      context += '_Use `aimem_decisions <topic>` to query more context._\n\n';

      if (decisions.length > 0) {
        context += '### Recent Decisions\n';
        decisions.slice(0, 5).forEach(d => { context += `- ${d}\n`; });
        context += '\n';
      }

      if (rejections.length > 0) {
        context += '### Approaches Rejected\n';
        rejections.slice(0, 3).forEach(r => { context += `- ${r}\n`; });
        context += '\n';
      }

      return context;
    } catch (err) {
      console.error('[aimem] Error getting context:', err);
      return '';
    }
  }

  private injectContextIntoRequest(body: any, host: string, context: string): any {
    if (!context) return body;

    // Anthropic API: uses "system" field
    if (host.includes('anthropic') && body.messages) {
      body.system = context + '\n\n' + (body.system || '');
      return body;
    }

    // Gemini API: uses "system_instruction" field
    if (host.includes('googleapis')) {
      if (body.system_instruction?.parts) {
        body.system_instruction.parts.unshift({ text: context + '\n\n' });
      } else {
        body.system_instruction = { parts: [{ text: context }] };
      }
      return body;
    }

    // Cohere API: uses "preamble" field
    if (host.includes('cohere')) {
      body.preamble = context + '\n\n' + (body.preamble || '');
      return body;
    }

    // OpenAI-compatible APIs: prepend/modify system message
    if (body.messages) {
      if (body.messages[0]?.role === 'system') {
        body.messages[0].content = context + '\n\n' + body.messages[0].content;
      } else {
        body.messages.unshift({ role: 'system', content: context });
      }
    }

    return body;
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

      if (extractions.length === 0) return;

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

    // Pass through non-target hosts
    await this.server.forAnyRequest().thenPassThrough();

    // Intercept target LLM API hosts
    for (const targetHost of TARGET_HOSTS) {
      await this.server.forAnyRequest()
        .forHostname(targetHost)
        .thenPassThrough({
          // Modify request before sending
          beforeRequest: async (request) => {
            const context = this.getRelevantContext();
            if (!context) return {};

            try {
              const bodyText = await request.body.getText() || '{}';
              const body = JSON.parse(bodyText);
              const modified = this.injectContextIntoRequest(body, targetHost, context);
              console.log(`[aimem] Injected context into ${this.getToolFromHost(targetHost)} request`);
              return {
                body: JSON.stringify(modified),
              };
            } catch {
              return {};
            }
          },

          // Capture response after receiving
          beforeResponse: async (response) => {
            try {
              const contentType = response.headers['content-type'] || '';
              let assistantContent = '';
              const requestData = {};

              const responseText = await response.body.getText() || '';

              if (contentType.includes('text/event-stream')) {
                // SSE streaming response
                assistantContent = this.parseSSEContent(responseText);
              } else {
                // Regular JSON response
                const body = JSON.parse(responseText || '{}');
                assistantContent = this.extractAssistantContent(body);
              }

              if (assistantContent) {
                const tool = this.getToolFromHost(targetHost);
                this.storeConversation('unknown', tool, requestData, assistantContent);
              }
            } catch (err) {
              // Don't break the response on errors
            }

            return {}; // Don't modify response
          },
        });
    }

    console.log(`[aimem] Proxy started on port ${port}`);
    console.log(`[aimem] CA certificate: ${this.certPath}`);

    const fingerprint = await mockttp.generateSPKIFingerprint(https.cert);
    console.log(`[aimem] CA fingerprint: ${fingerprint}`);
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

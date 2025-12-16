"""
mitmproxy addon for aimem
Intercepts LLM API calls, stores conversations, extracts decisions, and injects context.
"""

import json
import os
import re
import sqlite3
from datetime import datetime
from mitmproxy import http, ctx

# Target API hosts
TARGET_HOSTS = [
    # Anthropic
    "api.anthropic.com",
    # OpenAI
    "api.openai.com",
    # Google
    "generativelanguage.googleapis.com",  # Gemini
    # Mistral
    "api.mistral.ai",
    # Cohere
    "api.cohere.ai",
    "api.cohere.com",
    # Groq
    "api.groq.com",
    # Together AI
    "api.together.xyz",
    # Perplexity
    "api.perplexity.ai",
    # Fireworks
    "api.fireworks.ai",
    # Replicate
    "api.replicate.com",
    # DeepSeek
    "api.deepseek.com",
    # Local
    "localhost:11434",  # Ollama
    "127.0.0.1:11434",  # Ollama alt
    "localhost:1234",   # LM Studio
    "127.0.0.1:1234",   # LM Studio alt
]

# Decision extraction patterns
DECISION_PATTERNS = [
    r"(?:we should|let's|I'll|I will|going to|decided to|will use|using|chose|choosing|the best approach is|recommend using)\s+(.+?)(?:\.|$)",
    r"(?:the approach|the solution|the fix|the implementation|the strategy)\s+(?:is|will be|should be)\s+(.+?)(?:\.|$)",
    r"(?:because|since|the reason is|this is because)\s+(.+?)(?:\.|$)",
    r"(?:I've implemented|I've added|I've created|I've updated)\s+(.+?)(?:\.|$)",
]

REJECTION_PATTERNS = [
    r"(?:instead of|rather than|not using|won't use|shouldn't use|avoid using|don't use)\s+(.+?)(?:\.|$)",
    r"(?:rejected|ruled out|decided against|not recommended|wouldn't work)\s+(.+?)(?:\.|$)",
    r"(?:the problem with|the issue with|doesn't work because)\s+(.+?)(?:\.|$)",
]

# Common words to filter out from entity detection
COMMON_WORDS = {
    'the', 'this', 'that', 'these', 'those', 'then', 'than',
    'will', 'would', 'should', 'could', 'can', 'may', 'might',
    'have', 'has', 'had', 'get', 'set', 'let', 'var', 'const',
    'function', 'class', 'def', 'return', 'true', 'false', 'null',
    'undefined', 'new', 'for', 'while', 'if', 'else', 'try', 'catch',
    'import', 'export', 'from', 'require', 'module', 'use', 'using',
    'String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'Error',
}


class AimemInterceptor:
    def __init__(self):
        self.data_dir = os.environ.get("AIMEM_DATA_DIR", os.path.expanduser("~/.aimem"))
        self.db_path = os.path.join(self.data_dir, "aimem.db")
        self.pending_requests = {}
        self.current_project_id = None
        self._detect_project()

    def _detect_project(self):
        """Detect current project from CWD."""
        try:
            cwd = os.getcwd()
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT id, path FROM projects ORDER BY length(path) DESC")
            projects = cursor.fetchall()
            conn.close()

            for project_id, project_path in projects:
                if cwd.startswith(project_path):
                    self.current_project_id = project_id
                    ctx.log.info(f"[aimem] Detected project ID: {project_id}")
                    return
        except Exception as e:
            ctx.log.error(f"[aimem] Error detecting project: {e}")

    def load(self, loader):
        loader.add_option(
            name="data_dir",
            typespec=str,
            default=os.path.expanduser("~/.aimem"),
            help="aimem data directory",
        )
        loader.add_option(
            name="project_id",
            typespec=int,
            default=0,
            help="aimem project ID (0 for auto-detect)",
        )

    def configure(self, updates):
        if "data_dir" in updates:
            self.data_dir = ctx.options.data_dir
            self.db_path = os.path.join(self.data_dir, "aimem.db")
        if "project_id" in updates and ctx.options.project_id > 0:
            self.current_project_id = ctx.options.project_id

    def is_target_host(self, host: str) -> bool:
        return any(target in host for target in TARGET_HOSTS)

    def get_model_from_request(self, data: dict) -> str:
        """Extract model name from request data."""
        return data.get("model", "unknown")

    def get_tool_from_host(self, host: str) -> str:
        """Determine tool based on API host."""
        host_lower = host.lower()
        if "anthropic" in host_lower:
            return "claude"
        if "openai" in host_lower:
            return "openai"
        if "generativelanguage.googleapis" in host_lower:
            return "gemini"
        if "mistral" in host_lower:
            return "mistral"
        if "cohere" in host_lower:
            return "cohere"
        if "groq" in host_lower:
            return "groq"
        if "together" in host_lower:
            return "together"
        if "perplexity" in host_lower:
            return "perplexity"
        if "fireworks" in host_lower:
            return "fireworks"
        if "replicate" in host_lower:
            return "replicate"
        if "deepseek" in host_lower:
            return "deepseek"
        if "11434" in host_lower or ("localhost" in host_lower and "ollama" not in host_lower):
            return "ollama"
        if "1234" in host_lower:
            return "lmstudio"
        return "unknown"

    def extract_decisions(self, content: str) -> list:
        """Extract decisions and rejections from assistant content."""
        extractions = []

        # Extract decisions
        for pattern in DECISION_PATTERNS:
            for match in re.finditer(pattern, content, re.IGNORECASE):
                sentence = self._get_sentence_around(content, match.start())
                if self._is_valid_extraction(sentence):
                    entities = self._extract_entities(sentence)
                    extractions.append({
                        'type': 'decision',
                        'content': sentence.strip(),
                        'entities': entities,
                    })

        # Extract rejections
        for pattern in REJECTION_PATTERNS:
            for match in re.finditer(pattern, content, re.IGNORECASE):
                sentence = self._get_sentence_around(content, match.start())
                if self._is_valid_extraction(sentence):
                    entities = self._extract_entities(sentence)
                    extractions.append({
                        'type': 'rejection',
                        'content': sentence.strip(),
                        'entities': entities,
                    })

        # Deduplicate
        seen = set()
        unique = []
        for ext in extractions:
            key = ext['content'][:80].lower()
            if key not in seen:
                seen.add(key)
                unique.append(ext)

        return unique

    def _get_sentence_around(self, text: str, index: int) -> str:
        """Get the sentence containing the match."""
        # Find start
        start = max(0, text.rfind('.', 0, index) + 1, text.rfind('\n', 0, index) + 1)
        # Find end
        end_dot = text.find('.', index)
        end_newline = text.find('\n', index)
        end = len(text)
        if end_dot != -1:
            end = min(end, end_dot + 1)
        if end_newline != -1:
            end = min(end, end_newline)
        return text[start:end].strip()

    def _is_valid_extraction(self, sentence: str) -> bool:
        """Check if extraction is valid."""
        if len(sentence) < 30 or len(sentence) > 500:
            return False
        # Too much code
        if sentence.count('{') + sentence.count('}') > 3:
            return False
        if '```' in sentence:
            return False
        return True

    def _extract_entities(self, text: str) -> list:
        """Extract entity names from text."""
        entities = set()
        # Class names (CamelCase)
        for match in re.finditer(r'\b([A-Z][a-zA-Z0-9]*(?:Service|Controller|Model|Helper|Manager|Handler)?)\b', text):
            name = match.group(1)
            if name not in COMMON_WORDS and len(name) > 2:
                entities.add(name)
        return list(entities)

    def _is_duplicate_extraction(self, cursor, content: str, project_id: int, window_seconds: int = 300) -> bool:
        """Check if this extraction already exists within the time window."""
        try:
            # Check for duplicate extraction content within the last N seconds
            cursor.execute("""
                SELECT COUNT(*) FROM extractions e
                JOIN conversations c ON e.conversation_id = c.id
                WHERE e.content = ?
                AND c.project_id = ?
                AND datetime(c.timestamp) > datetime('now', ?)
            """, (content.strip(), project_id, f'-{window_seconds} seconds'))
            count = cursor.fetchone()[0]
            return count > 0
        except Exception:
            return False

    def store_conversation(self, model: str, tool: str, content: str, extractions: list, assistant_content: str = ""):
        """Store conversation and extractions in SQLite database."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Filter out duplicate extractions (deduplication layer)
            unique_extractions = []
            for ext in extractions:
                if not self._is_duplicate_extraction(cursor, ext['content'], self.current_project_id):
                    unique_extractions.append(ext)
                else:
                    ctx.log.info(f"[aimem] Skipping duplicate extraction: {ext['content'][:50]}...")

            # Only store conversation if we have unique extractions or no extractions at all
            if not extractions or unique_extractions:
                # Store conversation with assistant_content in summary for FTS
                cursor.execute("""
                    INSERT INTO conversations (project_id, model, tool, summary, raw_content, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (self.current_project_id, model, tool, assistant_content, content, datetime.now().isoformat()))

                conversation_id = cursor.lastrowid
            else:
                # All extractions were duplicates, skip storing
                ctx.log.info("[aimem] All extractions were duplicates, skipping conversation storage")
                conn.close()
                return

            # Store unique extractions
            for ext in unique_extractions:
                cursor.execute("""
                    INSERT INTO extractions (conversation_id, type, content, metadata)
                    VALUES (?, ?, ?, ?)
                """, (conversation_id, ext['type'], ext['content'], json.dumps({'entities': ext['entities']})))

                extraction_id = cursor.lastrowid

                # Link to structures if project is set
                if self.current_project_id and ext['entities']:
                    for entity in ext['entities']:
                        cursor.execute("""
                            SELECT s.id FROM structures s
                            JOIN files f ON s.file_id = f.id
                            WHERE s.name = ? AND f.project_id = ?
                        """, (entity, self.current_project_id))
                        structures = cursor.fetchall()
                        for (struct_id,) in structures:
                            link_type = 'decision' if ext['type'] == 'decision' else 'rejected'
                            cursor.execute("""
                                INSERT OR IGNORE INTO links (source_type, source_id, target_type, target_id, link_type)
                                VALUES ('extraction', ?, 'structure', ?, ?)
                            """, (extraction_id, struct_id, link_type))

            conn.commit()
            conn.close()
            ctx.log.info(f"[aimem] Stored conversation ({model}) with {len(extractions)} extractions")
        except Exception as e:
            ctx.log.error(f"[aimem] Error storing conversation: {e}")

    def get_relevant_context(self, messages: list) -> str:
        """Query database for relevant context based on conversation."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # Get recent decisions for current project
            if self.current_project_id:
                cursor.execute("""
                    SELECT e.content, e.type FROM extractions e
                    JOIN conversations c ON e.conversation_id = c.id
                    WHERE c.project_id = ? AND e.type IN ('decision', 'rejection')
                    ORDER BY c.timestamp DESC
                    LIMIT 10
                """, (self.current_project_id,))
            else:
                cursor.execute("""
                    SELECT content, type FROM extractions
                    WHERE type IN ('decision', 'rejection')
                    ORDER BY id DESC
                    LIMIT 5
                """)

            results = cursor.fetchall()
            conn.close()

            # Always include timestamp
            now = datetime.now()
            timestamp_str = now.strftime("%Y-%m-%d %H:%M:%S %Z").strip()

            if results:
                decisions = [r[0] for r in results if r[1] == 'decision']
                rejections = [r[0] for r in results if r[1] == 'rejection']

                context = f"## Context (from aimem)\n\n**Current time:** {timestamp_str}\n\n"
                context += "_Use `aimem_decisions <topic>` to query more context before claiming something isn't implemented._\n\n"
                if decisions:
                    context += "### Recent Decisions\n"
                    for d in decisions[:5]:
                        context += f"- {d}\n"
                    context += "\n"
                if rejections:
                    context += "### Approaches Rejected\n"
                    for r in rejections[:3]:
                        context += f"- {r}\n"
                    context += "\n"
                return context
            else:
                # No decisions yet, but still include timestamp and remind about aimem tools
                return f"## Context (from aimem)\n\n**Current time:** {timestamp_str}\n\n_Use `aimem_decisions <topic>` to check past decisions and `aimem_verify <name>` to check if code exists._\n\n"
        except Exception as e:
            ctx.log.error(f"[aimem] Error getting context: {e}")

        return ""

    def _parse_sse_content(self, raw_content: bytes) -> str:
        """Parse Server-Sent Events (SSE) streaming response and extract text."""
        content = ""
        try:
            text = raw_content.decode('utf-8', errors='ignore')

            for line in text.split('\n'):
                line = line.strip()
                if not line.startswith('data:'):
                    continue

                data_str = line[5:].strip()  # Remove 'data:' prefix
                if data_str == '[DONE]':
                    continue

                try:
                    data = json.loads(data_str)

                    # Anthropic streaming format
                    # event: content_block_delta
                    # data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
                    if data.get('type') == 'content_block_delta':
                        delta = data.get('delta', {})
                        if delta.get('type') == 'text_delta':
                            content += delta.get('text', '')

                    # Also handle message_delta for final content
                    if data.get('type') == 'message_delta':
                        pass  # Usually just stop_reason, no text

                    # OpenAI streaming format
                    # data: {"choices":[{"delta":{"content":"..."}}]}
                    if 'choices' in data:
                        for choice in data.get('choices', []):
                            delta = choice.get('delta', {})
                            if delta.get('content'):
                                content += delta.get('content', '')

                    # Gemini streaming format
                    if 'candidates' in data:
                        for candidate in data.get('candidates', []):
                            candidate_content = candidate.get('content', {})
                            for part in candidate_content.get('parts', []):
                                if part.get('text'):
                                    content += part.get('text', '')

                except json.JSONDecodeError:
                    continue

        except Exception as e:
            ctx.log.warn(f"[aimem] Error parsing SSE: {e}")

        return content

    def _is_streaming_response(self, flow: http.HTTPFlow) -> bool:
        """Check if response is a streaming SSE response."""
        content_type = flow.response.headers.get('content-type', '')
        return 'text/event-stream' in content_type or 'stream' in content_type

    def _get_assistant_content(self, response_data: dict) -> str:
        """Extract assistant content from response."""
        content = ""

        # Anthropic format: {"content": [{"type": "text", "text": "..."}]}
        if "content" in response_data and isinstance(response_data.get("content"), list):
            for block in response_data.get("content", []):
                if isinstance(block, dict) and block.get("type") == "text":
                    content += block.get("text", "") + "\n"
                elif isinstance(block, str):
                    content += block + "\n"

        # OpenAI/Mistral/Groq/Together/etc format: {"choices": [{"message": {"content": "..."}}]}
        if "choices" in response_data:
            for choice in response_data.get("choices", []):
                msg = choice.get("message", {})
                if msg.get("content"):
                    content += msg.get("content", "") + "\n"
                # Streaming format: {"choices": [{"delta": {"content": "..."}}]}
                delta = choice.get("delta", {})
                if delta.get("content"):
                    content += delta.get("content", "") + "\n"

        # Gemini format: {"candidates": [{"content": {"parts": [{"text": "..."}]}}]}
        if "candidates" in response_data:
            for candidate in response_data.get("candidates", []):
                candidate_content = candidate.get("content", {})
                for part in candidate_content.get("parts", []):
                    if part.get("text"):
                        content += part.get("text", "") + "\n"

        # Cohere format: {"text": "..."} or {"generations": [{"text": "..."}]}
        if "text" in response_data and isinstance(response_data.get("text"), str):
            content += response_data.get("text", "") + "\n"
        if "generations" in response_data:
            for gen in response_data.get("generations", []):
                if gen.get("text"):
                    content += gen.get("text", "") + "\n"

        # Replicate format: {"output": "..." or ["..."]}
        if "output" in response_data:
            output = response_data.get("output")
            if isinstance(output, str):
                content += output + "\n"
            elif isinstance(output, list):
                content += "".join(str(o) for o in output) + "\n"

        return content

    def request(self, flow: http.HTTPFlow):
        """Handle outgoing requests."""
        if not self.is_target_host(flow.request.host):
            return

        try:
            # Store request for later matching with response
            self.pending_requests[flow.id] = {
                "host": flow.request.host,
                "timestamp": datetime.now().isoformat(),
            }

            # Parse request body
            if flow.request.content:
                data = json.loads(flow.request.content)
                self.pending_requests[flow.id]["request_data"] = data

                # Inject context into the request
                context = self.get_relevant_context(data.get("messages", []))

                if context:
                    host = flow.request.host.lower()
                    injected = False

                    # Anthropic API: uses "system" field
                    if "anthropic" in host and "messages" in data:
                        if "system" in data:
                            data["system"] = context + "\n\n" + data["system"]
                        else:
                            data["system"] = context
                        injected = True

                    # OpenAI-compatible APIs: prepend system message
                    # (OpenAI, Mistral, Groq, Together, DeepSeek, Fireworks, Perplexity, LM Studio, Ollama)
                    elif "messages" in data:
                        messages = data.get("messages", [])
                        if messages and messages[0].get("role") == "system":
                            messages[0]["content"] = context + "\n\n" + messages[0]["content"]
                        else:
                            messages.insert(0, {"role": "system", "content": context})
                        data["messages"] = messages
                        injected = True

                    # Gemini API: uses "system_instruction" field
                    if "generativelanguage.googleapis" in host:
                        if "system_instruction" in data:
                            existing = data["system_instruction"]
                            if isinstance(existing, dict) and "parts" in existing:
                                existing["parts"].insert(0, {"text": context + "\n\n"})
                            else:
                                data["system_instruction"] = {"parts": [{"text": context}]}
                        else:
                            data["system_instruction"] = {"parts": [{"text": context}]}
                        injected = True

                    # Cohere API: uses "preamble" field
                    if "cohere" in host:
                        if "preamble" in data:
                            data["preamble"] = context + "\n\n" + data["preamble"]
                        else:
                            data["preamble"] = context
                        injected = True

                    if injected:
                        flow.request.content = json.dumps(data).encode()
                        tool = self.get_tool_from_host(host)
                        ctx.log.info(f"[aimem] Injected context into {tool} request")

        except Exception as e:
            ctx.log.error(f"[aimem] Error processing request: {e}")

    def response(self, flow: http.HTTPFlow):
        """Handle incoming responses."""
        if flow.id not in self.pending_requests:
            return

        try:
            request_info = self.pending_requests.pop(flow.id)

            if flow.response and flow.response.content:
                request_data = request_info.get("request_data", {})
                assistant_content = ""
                response_data = {}

                # Check if this is a streaming response
                if self._is_streaming_response(flow):
                    # Parse SSE streaming content
                    assistant_content = self._parse_sse_content(flow.response.content)
                    response_data = {"streamed_content": assistant_content[:1000]}  # Store truncated for reference
                    ctx.log.info(f"[aimem] Parsed streaming response: {len(assistant_content)} chars")
                else:
                    # Regular JSON response
                    try:
                        response_data = json.loads(flow.response.content)
                        assistant_content = self._get_assistant_content(response_data)
                    except json.JSONDecodeError:
                        ctx.log.warn("[aimem] Could not parse response as JSON")
                        return

                # Extract decisions from assistant response
                if assistant_content:
                    extractions = self.extract_decisions(assistant_content)

                    # Combine request and response for storage
                    conversation = {
                        "request": request_data,
                        "response": response_data,
                        "assistant_content": assistant_content[:5000],  # Store first 5k chars
                        "timestamp": request_info["timestamp"],
                    }

                    model = self.get_model_from_request(request_data)
                    tool = self.get_tool_from_host(request_info["host"])

                    self.store_conversation(model, tool, json.dumps(conversation), extractions, assistant_content)

                    if extractions:
                        ctx.log.info(f"[aimem] Extracted {len(extractions)} decisions from {tool} response")
                else:
                    ctx.log.debug("[aimem] No assistant content found in response")

        except Exception as e:
            ctx.log.error(f"[aimem] Error processing response: {e}")


addons = [AimemInterceptor()]

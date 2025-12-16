// Helper to find line numbers from character positions
export function getLineNumber(content, position) {
    return content.slice(0, position).split('\n').length;
}
// Helper to extract raw content between lines
export function extractLines(content, startLine, endLine) {
    const lines = content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
}
//# sourceMappingURL=base.js.map
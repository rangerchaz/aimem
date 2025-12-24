/**
 * Setup command: Automatically configure aimem for various AI coding tools
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';
function getAimemPath() {
    try {
        // Try to find aimem in PATH
        const result = execSync('which aimem', { encoding: 'utf-8' }).trim();
        if (result)
            return result;
    }
    catch {
        // Fall through
    }
    // Fallback: check common locations
    const possiblePaths = [
        join(homedir(), '.nvm/versions/node', process.version, 'bin/aimem'),
        '/usr/local/bin/aimem',
        '/usr/bin/aimem',
        join(homedir(), '.npm-global/bin/aimem'),
    ];
    for (const p of possiblePaths) {
        if (existsSync(p))
            return p;
    }
    // Last resort: use npx
    return 'npx aimem';
}
function readJsonFile(path) {
    try {
        if (!existsSync(path))
            return null;
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
function writeJsonFile(path, data) {
    const dir = dirname(path);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}
function getPlatform() {
    const platform = process.platform;
    if (platform === 'darwin')
        return 'macos';
    if (platform === 'win32')
        return 'windows';
    // Check for WSL
    try {
        const release = execSync('uname -r', { encoding: 'utf-8' }).toLowerCase();
        if (release.includes('microsoft') || release.includes('wsl'))
            return 'wsl';
    }
    catch {
        // Ignore
    }
    return 'linux';
}
function getShellProfile() {
    const shell = process.env.SHELL || '/bin/bash';
    const home = homedir();
    if (shell.includes('zsh')) {
        return join(home, '.zshrc');
    }
    else if (shell.includes('fish')) {
        return join(home, '.config/fish/config.fish');
    }
    return join(home, '.bashrc');
}
function getAimemCertPath() {
    return join(homedir(), '.aimem', 'ca-cert.pem');
}
function ensureAimemCert() {
    const certPath = getAimemCertPath();
    if (existsSync(certPath)) {
        return certPath;
    }
    // Certificate will be generated when proxy starts
    // For now, return the expected path
    console.log(chalk.yellow('CA certificate will be generated when proxy starts.'));
    console.log(chalk.yellow('Run `aimem start` first, then run setup again to install the cert.\n'));
    return null;
}
async function installCertificate(certPath, platform) {
    console.log(chalk.bold('\nInstalling CA certificate...\n'));
    try {
        if (platform === 'macos') {
            console.log('Adding certificate to macOS keychain (requires password)...');
            execSync(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`, {
                stdio: 'inherit',
            });
            return true;
        }
        if (platform === 'linux') {
            const destPath = '/usr/local/share/ca-certificates/aimem-ca-cert.crt';
            console.log('Adding certificate to system CA store (requires sudo)...');
            execSync(`sudo cp "${certPath}" "${destPath}" && sudo update-ca-certificates`, {
                stdio: 'inherit',
            });
            return true;
        }
        if (platform === 'wsl') {
            // For WSL, install to both Linux and Windows
            const destPath = '/usr/local/share/ca-certificates/aimem-ca-cert.crt';
            console.log('Adding certificate to Linux CA store (requires sudo)...');
            execSync(`sudo cp "${certPath}" "${destPath}" && sudo update-ca-certificates`, {
                stdio: 'inherit',
            });
            console.log(chalk.yellow('\nFor Windows applications, you also need to install the cert on Windows:'));
            console.log(chalk.cyan(`  1. Copy cert to Windows: cp ${certPath} /mnt/c/temp/aimem-ca-cert.crt`));
            console.log(chalk.cyan('  2. Run in PowerShell (as admin):'));
            console.log(chalk.cyan('     certutil -addstore -f "ROOT" C:\\temp\\aimem-ca-cert.crt'));
            return true;
        }
        if (platform === 'windows') {
            console.log('Adding certificate to Windows certificate store (requires admin)...');
            execSync(`certutil -addstore -f "ROOT" "${certPath}"`, {
                stdio: 'inherit',
            });
            return true;
        }
    }
    catch (err) {
        console.log(chalk.red('Failed to install certificate automatically.'));
        console.log(chalk.yellow(`\nManually install the certificate from: ${certPath}`));
        return false;
    }
    return false;
}
function setupAutostart(aimemPath, port, platform) {
    console.log(chalk.bold('\nConfiguring autostart...\n'));
    if (platform === 'macos') {
        // macOS: Use launchd
        const plistDir = join(homedir(), 'Library', 'LaunchAgents');
        const plistPath = join(plistDir, 'com.aimem.proxy.plist');
        if (!existsSync(plistDir)) {
            mkdirSync(plistDir, { recursive: true });
        }
        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.aimem.proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>${aimemPath}</string>
    <string>start</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), '.aimem', 'proxy.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), '.aimem', 'proxy.error.log')}</string>
</dict>
</plist>
`;
        try {
            writeFileSync(plistPath, plistContent);
            // Load the service
            execSync(`launchctl load "${plistPath}"`, { stdio: 'inherit' });
            console.log(chalk.green(`Created launchd service: ${plistPath}`));
            console.log(chalk.green('Proxy will start automatically on login.'));
            return true;
        }
        catch (err) {
            console.log(chalk.red('Failed to set up launchd service.'));
            console.log(chalk.yellow(`Manually load with: launchctl load "${plistPath}"`));
            return false;
        }
    }
    if (platform === 'linux' || platform === 'wsl') {
        // Linux/WSL: Use systemd user service
        const systemdDir = join(homedir(), '.config', 'systemd', 'user');
        const servicePath = join(systemdDir, 'aimem-proxy.service');
        if (!existsSync(systemdDir)) {
            mkdirSync(systemdDir, { recursive: true });
        }
        const serviceContent = `[Unit]
Description=aimem proxy for AI coding assistants
After=network.target

[Service]
Type=simple
ExecStart=${aimemPath} start --port ${port}
Restart=on-failure
RestartSec=5
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target
`;
        try {
            writeFileSync(servicePath, serviceContent);
            // Reload systemd and enable the service
            execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
            execSync('systemctl --user enable aimem-proxy.service', { stdio: 'inherit' });
            console.log(chalk.green(`Created systemd user service: ${servicePath}`));
            console.log(chalk.green('Proxy will start automatically on login.'));
            console.log(chalk.cyan('\nManual control:'));
            console.log('  Start now:  systemctl --user start aimem-proxy');
            console.log('  Stop:       systemctl --user stop aimem-proxy');
            console.log('  Status:     systemctl --user status aimem-proxy');
            console.log('  Disable:    systemctl --user disable aimem-proxy');
            return true;
        }
        catch (err) {
            console.log(chalk.red('Failed to set up systemd service.'));
            console.log(chalk.yellow(`Service file created at: ${servicePath}`));
            console.log(chalk.yellow('Manually enable with:'));
            console.log(chalk.cyan('  systemctl --user daemon-reload'));
            console.log(chalk.cyan('  systemctl --user enable aimem-proxy.service'));
            return false;
        }
    }
    console.log(chalk.yellow(`Autostart not supported on platform: ${platform}`));
    return false;
}
function addToShellProfile(profilePath, port, certPath) {
    const marker = '# aimem proxy configuration';
    // Build env block with proper Node.js SSL handling
    let envBlock = `
${marker}
export HTTP_PROXY=http://localhost:${port}
export HTTPS_PROXY=http://localhost:${port}
`;
    // Add Node.js cert configuration
    if (certPath) {
        envBlock += `export NODE_EXTRA_CA_CERTS="${certPath}"
`;
    }
    try {
        let content = '';
        if (existsSync(profilePath)) {
            content = readFileSync(profilePath, 'utf-8');
            // Check if already configured
            if (content.includes(marker)) {
                console.log(chalk.yellow(`Shell profile already configured: ${profilePath}`));
                return true;
            }
        }
        // Append to profile
        writeFileSync(profilePath, content + envBlock);
        console.log(chalk.green(`Added proxy environment to: ${profilePath}`));
        return true;
    }
    catch (err) {
        console.log(chalk.red(`Failed to update shell profile: ${profilePath}`));
        return false;
    }
}
export async function setupCommand(tool, options) {
    const supportedTools = ['claude-code', 'proxy', 'cursor', 'continue'];
    if (!tool) {
        console.log(chalk.bold('aimem setup\n'));
        console.log('Automatically configure aimem for AI coding tools.\n');
        console.log('Usage:');
        console.log('  aimem setup claude-code    Configure for Claude Code (MCP server)');
        console.log('  aimem setup proxy          Configure proxy for any tool (Cursor, etc.)');
        console.log('  aimem setup cursor         Show Cursor configuration instructions');
        console.log('  aimem setup continue       Show Continue.dev configuration instructions\n');
        console.log('Supported tools:', supportedTools.join(', '));
        return;
    }
    if (!supportedTools.includes(tool)) {
        console.log(chalk.red(`Unknown tool: ${tool}`));
        console.log('Supported tools:', supportedTools.join(', '));
        process.exit(1);
    }
    if (tool === 'claude-code') {
        await setupClaudeCode(options);
    }
    else if (tool === 'proxy') {
        await setupProxy(options);
    }
    else if (tool === 'cursor') {
        await setupCursor(options);
    }
    else if (tool === 'continue') {
        await setupContinue(options);
    }
}
async function setupClaudeCode(options) {
    console.log(chalk.bold('Setting up aimem for Claude Code...\n'));
    const aimemPath = getAimemPath();
    console.log(`Found aimem at: ${chalk.cyan(aimemPath)}`);
    // Claude Code settings file location
    const claudeDir = join(homedir(), '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    // Read existing settings or create new
    let settings = {};
    const existingSettings = readJsonFile(settingsPath);
    if (existingSettings) {
        settings = existingSettings;
        console.log(`Found existing settings at: ${chalk.cyan(settingsPath)}`);
    }
    else {
        console.log(`Creating new settings file at: ${chalk.cyan(settingsPath)}`);
    }
    // Track what we're changing
    const changes = [];
    // Configure MCP server (for query tools)
    if (!settings.mcpServers) {
        settings.mcpServers = {};
    }
    if (!settings.mcpServers.aimem || options.force) {
        settings.mcpServers.aimem = {
            command: aimemPath,
            args: ['mcp-serve'],
        };
        changes.push('Added aimem MCP server (query tools)');
    }
    else {
        console.log(chalk.yellow('MCP server already configured (use --force to overwrite)'));
    }
    // Write settings
    if (changes.length > 0) {
        writeJsonFile(settingsPath, settings);
        console.log(chalk.green('\nConfiguration updated:'));
        for (const change of changes) {
            console.log(chalk.green(`  ✓ ${change}`));
        }
    }
    else {
        console.log(chalk.green('\nMCP server already configured.'));
    }
    console.log(chalk.bold('\nNext steps:'));
    console.log('  1. Restart Claude Code to load the MCP server');
    console.log('  2. Set up the proxy for context capture:');
    console.log(chalk.cyan('     aimem setup proxy --install'));
    console.log('  3. Start the proxy before using Claude Code:');
    console.log(chalk.cyan('     aimem start'));
    console.log('  4. Run `aimem init` in your project directory to index it\n');
    console.log(chalk.yellow('Note: The proxy captures decisions in real-time.'));
    console.log(chalk.yellow('MCP provides query tools for retrieving context on-demand.\n'));
}
async function setupProxy(options) {
    console.log(chalk.bold('Setting up aimem proxy...\n'));
    const port = options.port || '8080';
    const install = options.install || false;
    const autostart = options.autostart || false;
    const platform = getPlatform();
    console.log(`Detected platform: ${chalk.cyan(platform)}`);
    // Create a startup script
    const aimemPath = getAimemPath();
    const startupScript = `#!/bin/bash
# Start aimem proxy
${aimemPath} start --port ${port}
`;
    const aimemDir = join(homedir(), '.aimem');
    if (!existsSync(aimemDir)) {
        mkdirSync(aimemDir, { recursive: true });
    }
    // Write startup script
    const scriptPath = join(aimemDir, 'start-proxy.sh');
    writeFileSync(scriptPath, startupScript, { mode: 0o755 });
    // Write profile snippet (for manual sourcing)
    const certPath = getAimemCertPath();
    const profileAdditions = `
# aimem proxy configuration
export HTTP_PROXY=http://localhost:${port}
export HTTPS_PROXY=http://localhost:${port}
export NODE_EXTRA_CA_CERTS="${certPath}"
`;
    const profileSnippetPath = join(aimemDir, 'proxy-env.sh');
    writeFileSync(profileSnippetPath, profileAdditions);
    console.log(chalk.green('\nFiles created:'));
    console.log(`  ${chalk.cyan(scriptPath)} - Start proxy script`);
    console.log(`  ${chalk.cyan(profileSnippetPath)} - Environment variables`);
    if (install) {
        // Full installation mode
        console.log(chalk.bold('\n--- Full Installation Mode ---\n'));
        // Step 1: Ensure certificate exists (or start proxy to generate it)
        const certPath = ensureAimemCert();
        if (!certPath) {
            console.log(chalk.yellow('To complete setup:'));
            console.log('  1. Run: ' + chalk.cyan('aimem start'));
            console.log('  2. Then run: ' + chalk.cyan('aimem setup proxy --install'));
            return;
        }
        console.log(chalk.green(`Certificate found: ${certPath}`));
        // Step 2: Install certificate
        await installCertificate(certPath, platform);
        // Step 3: Add to shell profile
        const profilePath = getShellProfile();
        console.log(chalk.bold('\nConfiguring shell environment...\n'));
        addToShellProfile(profilePath, port, certPath);
        console.log(chalk.green(chalk.bold('\n✓ Proxy installation complete!\n')));
        console.log(chalk.bold('Next steps:'));
        console.log('  1. Restart your terminal (or run: ' + chalk.cyan(`source ${profilePath}`) + ')');
        console.log('  2. Start the proxy: ' + chalk.cyan('aimem start'));
        console.log('  3. Your HTTP_PROXY and HTTPS_PROXY are now set automatically\n');
        if (platform === 'wsl') {
            console.log(chalk.yellow('WSL Note: For Windows apps (like Cursor), you may need to:'));
            console.log('  - Install the cert on Windows (see instructions above)');
            console.log('  - Configure the proxy in the app settings manually\n');
        }
        // Handle autostart if requested
        if (autostart) {
            setupAutostart(aimemPath, port, platform);
        }
        else {
            console.log(chalk.cyan('Tip: Add --autostart to start the proxy automatically on login.\n'));
        }
    }
    else if (autostart) {
        // Autostart without full install
        setupAutostart(aimemPath, port, platform);
    }
    else {
        // Manual setup instructions
        console.log(chalk.bold('\nTo use the proxy:\n'));
        console.log('Option A: ' + chalk.bold('Automatic setup (recommended)'));
        console.log(chalk.cyan(`   aimem setup proxy --install\n`));
        console.log('Option B: ' + chalk.bold('Manual setup'));
        console.log('  1. Start the proxy:');
        console.log(chalk.cyan(`     aimem start --port ${port}\n`));
        console.log('  2. Trust the CA certificate:');
        console.log(chalk.cyan(`     # Certificate is at: ${certPath}`));
        console.log(chalk.cyan('     # Install it to your system trust store\n'));
        console.log('  3. Set environment variables (add to your shell profile):');
        console.log(chalk.cyan(`     export HTTP_PROXY=http://localhost:${port}`));
        console.log(chalk.cyan(`     export HTTPS_PROXY=http://localhost:${port}\n`));
        console.log('  4. Or source the env file:');
        console.log(chalk.cyan(`     source ${profileSnippetPath}\n`));
    }
    console.log(chalk.bold('Supported tools with proxy:'));
    console.log('  - Cursor (set proxy in settings)');
    console.log('  - Continue.dev (respects HTTP_PROXY)');
    console.log('  - Any tool that respects HTTP_PROXY/HTTPS_PROXY\n');
    console.log(chalk.yellow('Note: The proxy intercepts API calls to:'));
    console.log('  - api.anthropic.com');
    console.log('  - api.openai.com');
    console.log('  - localhost:11434 (Ollama)\n');
}
async function setupCursor(options) {
    const port = options.port || '8080';
    console.log(chalk.bold('Setting up aimem for Cursor...\n'));
    console.log('Cursor supports MCP servers. Add to your Cursor settings:\n');
    console.log(chalk.bold('Option 1: MCP Server (query only, no auto-capture)\n'));
    console.log('Add to Cursor settings.json:');
    const aimemPath = getAimemPath();
    console.log(chalk.cyan(`{
  "mcpServers": {
    "aimem": {
      "command": "${aimemPath}",
      "args": ["mcp-serve"]
    }
  }
}\n`));
    console.log(chalk.bold('Option 2: Proxy mode (full capture)\n'));
    console.log('1. Run: ' + chalk.cyan(`aimem setup proxy --port ${port}`));
    console.log('2. Start proxy: ' + chalk.cyan('aimem start'));
    console.log('3. In Cursor settings, set HTTP proxy to: ' + chalk.cyan(`http://localhost:${port}`));
    console.log('4. Trust the CA certificate at: ' + chalk.cyan(getAimemCertPath()) + '\n');
    console.log(chalk.yellow('Note: MCP mode provides query tools but won\'t auto-capture decisions.'));
    console.log('Use proxy mode for automatic decision capture.\n');
}
async function setupContinue(options) {
    const port = options.port || '8080';
    console.log(chalk.bold('Setting up aimem for Continue.dev...\n'));
    const aimemPath = getAimemPath();
    console.log(chalk.bold('Option 1: MCP Server (query only)\n'));
    console.log('Add to ~/.continue/config.json:');
    console.log(chalk.cyan(`{
  "experimental": {
    "mcpServers": [
      {
        "name": "aimem",
        "command": "${aimemPath}",
        "args": ["mcp-serve"]
      }
    ]
  }
}\n`));
    console.log(chalk.bold('Option 2: Proxy mode (full capture)\n'));
    console.log('1. Run: ' + chalk.cyan(`aimem setup proxy --port ${port}`));
    console.log('2. Start proxy: ' + chalk.cyan('aimem start'));
    console.log('3. Set environment variables:');
    console.log(chalk.cyan(`   export HTTP_PROXY=http://localhost:${port}`));
    console.log(chalk.cyan(`   export HTTPS_PROXY=http://localhost:${port}`));
    console.log('4. Start your IDE\n');
    console.log(chalk.yellow('Note: Continue.dev respects HTTP_PROXY environment variables.\n'));
}
//# sourceMappingURL=setup.js.map
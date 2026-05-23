#!/usr/bin/env python3
import json
import re
from collections import Counter
from pathlib import Path

# Dynamically find transcript files
claude_dir = Path.home() / ".claude" / "projects"
transcript_files = sorted(
    claude_dir.glob("**/*.jsonl"),
    key=lambda p: p.stat().st_mtime,
    reverse=True
)[:100]  # Take 100 most recent
print(f"Found {len(transcript_files)} transcript files to analyze...")

# Commands that are already auto-allowed (don't need allowlist entries)
AUTO_ALLOWED_ANY = {
    'cal', 'uptime', 'cat', 'head', 'tail', 'wc', 'stat', 'strings', 'hexdump', 'od', 'nl',
    'id', 'uname', 'free', 'df', 'du', 'locale', 'groups', 'nproc', 'basename', 'dirname',
    'realpath', 'cut', 'paste', 'tr', 'column', 'tac', 'rev', 'fold', 'expand', 'unexpand',
    'fmt', 'comm', 'cmp', 'numfmt', 'readlink', 'diff', 'true', 'false', 'sleep', 'which',
    'type', 'expr', 'test', 'getconf', 'seq', 'tsort', 'pr', 'echo', 'printf', 'ls', 'cd',
    'find', 'xargs', 'file', 'sed', 'sort', 'man', 'help', 'netstat', 'ps', 'base64',
    'grep', 'egrep', 'fgrep', 'sha256sum', 'sha1sum', 'md5sum', 'tree', 'date', 'hostname',
    'info', 'lsof', 'pgrep', 'tput', 'ss', 'fd', 'fdfind', 'aki', 'rg', 'jq', 'uniq',
    'history', 'arch', 'ifconfig', 'pyright'
}

bash_commands = Counter()
mcp_tools = Counter()
all_bash_commands = Counter()  # Before filtering

def extract_command(cmd):
    """Extract the leading command from a bash string."""
    # Remove leading env vars (VAR=value cmd)
    cmd = re.sub(r'^(\w+=\S+\s+)+', '', cmd.strip())
    # Remove sudo, timeout, etc.
    cmd = re.sub(r'^(sudo|timeout \d+[smh]?)\s+', '', cmd)
    # Split on pipes, &&, ||, ; and take first
    cmd = re.split(r'[|;&]', cmd)[0].strip()
    # Extract command and first arg
    parts = cmd.split(None, 2)  # Split into max 3 parts
    if not parts:
        return None

    base_cmd = parts[0]

    # For git/gh, include the subcommand
    if base_cmd in ('git', 'gh', 'docker', 'kubectl') and len(parts) > 1:
        return f"{base_cmd} {parts[1]}"

    return base_cmd

def is_read_only(cmd):
    """Check if a command is read-only and not auto-allowed."""
    if not cmd:
        return False

    # Check if it's in auto-allowed list
    base = cmd.split()[0]
    if base in AUTO_ALLOWED_ANY:
        return False  # Already auto-allowed, no need to add

    # Dangerous commands/patterns - never allow
    dangerous = ['python', 'python3', 'node', 'bun', 'deno', 'ruby', 'perl', 'php',
                 'bash', 'sh', 'zsh', 'eval', 'exec', 'ssh', 'npx', 'bunx', 'sudo',
                 'rm', 'mv', 'dd', 'mkfs']
    if base in dangerous:
        return False

    # Git - only certain read-only subcommands (most are auto-allowed already)
    if cmd.startswith('git '):
        return False  # Git read-only commands are already auto-allowed

    # GH - these are NOT auto-allowed
    if cmd.startswith('gh '):
        subcmd = cmd.split()[1] if len(cmd.split()) > 1 else ''
        readonly_gh = ['run', 'workflow', 'pr', 'issue', 'repo', 'release', 'api']
        if subcmd in readonly_gh:
            return True

    # Docker read-only
    if cmd.startswith('docker '):
        return False  # Docker read-only is auto-allowed

    # Other potentially useful read-only commands
    useful_readonly = ['curl', 'wget', 'env', 'printenv', 'top', 'htop', 'watch']
    if base in useful_readonly:
        return True

    return False

# Parse transcripts
for transcript_file in transcript_files:
    try:
        with open(transcript_file, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    obj = json.loads(line)
                    if obj.get('type') == 'assistant':
                        content = obj.get('message', {}).get('content', [])
                        for item in content:
                            if item.get('type') == 'tool_use':
                                tool_name = item.get('name')
                                tool_input = item.get('input', {})

                                # Bash commands
                                if tool_name == 'Bash':
                                    cmd = tool_input.get('command', '')
                                    extracted = extract_command(cmd)
                                    if extracted:
                                        all_bash_commands[extracted] += 1
                                        if is_read_only(extracted):
                                            bash_commands[extracted] += 1

                                # MCP tools (only read-only ones)
                                elif tool_name and tool_name.startswith('mcp__'):
                                    # Only include if it looks read-only
                                    if any(kw in tool_name.lower() for kw in ['read', 'get', 'list', 'search', 'view', 'fetch']):
                                        mcp_tools[tool_name] += 1

                except json.JSONDecodeError:
                    continue
    except FileNotFoundError:
        continue

# Output results
print("=== BASH COMMANDS (All found, sorted by frequency) ===")
if bash_commands:
    for cmd, count in bash_commands.most_common(30):
        print(f"{count:4d}  {cmd}")
else:
    print("No qualifying bash commands found")

print("\n=== MCP TOOLS (All found, sorted by frequency) ===")
if mcp_tools:
    for tool, count in mcp_tools.most_common(20):
        print(f"{count:4d}  {tool}")
else:
    print("No qualifying MCP tools found")

print("\n=== ALL BASH COMMANDS (Before filtering, top 50) ===")
if all_bash_commands:
    for cmd, count in all_bash_commands.most_common(50):
        filtered = "FILTERED" if cmd not in bash_commands else "OK"
        print(f"{count:4d}  {filtered:10s}  {cmd}")
else:
    print("No bash commands found in transcripts")

print("\n=== SUMMARY ===")
print(f"Total Bash commands analyzed (>= 3 occurrences): {len([c for c in bash_commands if bash_commands[c] >= 3])}")
print(f"Total Bash commands found (any count): {len(bash_commands)}")
print(f"Total MCP tools analyzed (>= 3 occurrences): {len([t for t in mcp_tools if mcp_tools[t] >= 3])}")
print(f"Total MCP tools found (any count): {len(mcp_tools)}")
print(f"Total Bash commands before filtering: {len(all_bash_commands)}")

#!/usr/bin/env node
// PreToolUse hook (see .claude/settings.json): before the first edit in a session to a file on the
// authorization path, remind Claude to trace the change through the whole round trip. CLAUDE.md
// says the same; this makes sure it is in front of Claude when it matters. It never blocks.
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Matched against the end of the path, so edits in a git worktree of this repo count too
const AUTH_PATH = [
  /(^|\/)src\/setup\/(proxy|index)\.ts$/,
  /(^|\/)src\/app(-fp)?\.ts$/,
  /(^|\/)src\/authFlow\.ts$/,
  /(^|\/)src\/routes\/(login|consent|callback|passthrough-auth|discovery)-fp\.ts$/,
  /(^|\/)src\/fp\/services\/(login|consent|callback|token|cimd|hydra)\.ts$/,
  /(^|\/)build\/nginx\/.+\.conf/,
];

const REMINDER = `This file is on the authorization path. A change to one leg can break another that its own tests never reach. Before editing:
1. Read the leg table in OAUTH2_ARCHITECTURE.md → "Authorization Code Flow with PKCE" and list every leg this change touches, including through what it stores, rewrites, requires or sets as a cookie.
2. Check every leg that sends a parameter, header or cookie you require, rewrite or drop. Leg 5 (Hydra's login return) is built from the query the proxy forwarded on leg 3, not what the client sent.
3. Run npm test and ./scripts/hydra-flow-test.sh, and extend src/test/authFlow.ts if you add a check or a leg.
4. If cookies, sessions, headers or redirect URLs are involved, check nginx/HAProxy too: the flow tests run over plain http with no proxy.
5. Name the legs touched in the PR, and try a real sign-in on staging.
A security fix that breaks sign-in never gets deployed.`;

let input = '';
for await (const chunk of process.stdin) input += chunk;

try {
  const { session_id: sessionId, cwd, tool_input: toolInput } = JSON.parse(input);
  const file = path.resolve(cwd ?? process.cwd(), toolInput?.file_path ?? '');
  if (!AUTH_PATH.some((pattern) => pattern.test(file))) process.exit(0);

  // Once per session: the reminder stays in context after that
  const marker = path.join(tmpdir(), `claude-auth-path-reminder-${String(sessionId).replace(/[^\w-]/g, '')}`);
  if (sessionId && existsSync(marker)) process.exit(0);
  if (sessionId) writeFileSync(marker, '');

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: REMINDER } }),
  );
} catch {
  // A broken hook must not get in the way of editing
}
process.exit(0);

---
name: submit-issue
description: When this plugin (an MCP tool or a Cognigy skill) fails a user's ask, errors unexpectedly, or wastes cycles figuring something out, use this skill to file a detailed GitHub issue against the plugin maintainers from conversation context — no user input required.
---

# submit-issue

File a GitHub issue against **ben-elliot-nice/cognigy-plugin-vibe** for a bug or unexpected behaviour in this plugin (an MCP tool, a skill, or the `cognigy-agent-builder`/`cognigy-voice-go-live` subagents). Synthesise from the current conversation — don't ask the user to write the report.

Use this when: a tool call fails in a way the docs/skill didn't predict, a tool returns a shape that doesn't match its description, you had to retry/guess repeatedly to get something working, or a skill's instructions turned out to be wrong or missing a case.

## Step 1: Synthesise issue content from conversation context

Extract from the current conversation:

- **Component**: the specific MCP tool (e.g. `manage_flow_nodes`, `create_ai_agent`) or skill/agent (e.g. `flow-nodes`, `cognigy-agent-builder`) involved. Use `unknown` if unclear.
- **What happened**: the observed behaviour.
- **What was expected**: the correct/intended behaviour per the tool description or skill.
- **Reproduction steps**: numbered steps that would reproduce it.
- **Error output**: raw error text, tool result, or API response. Use `none captured` if unavailable.
- **Root cause hypothesis**: your analysis, or `unknown`.
- **Context**: plugin version (see Step 1a), Cognigy environment/base URL shape, flow/agent/node IDs, anything relevant.

**Title format:** `[<component>] <short description of the failure>`

Examples:
- `[manage_flow_nodes] create with mode=prepend on start node throws "Error while reading ChartData"`
- `[cognigy-agent-builder] verification gate looped 3x on missing endpoint`

### Step 1a: Capture the plugin version

Read `plugin/.claude-plugin/plugin.json` `version` field if the repo is checked out locally, or ask the caller/inspect the MCP server's reported version. Use `unknown` if not determinable — do not guess.

**Body template:**

```markdown
## Component
<component>

## What happened
<observed behaviour>

## What was expected
<correct/intended behaviour>

## Reproduction steps
<numbered steps>

## Error output
<raw error text, or "none captured">

## Root cause hypothesis
<analysis, or "unknown">

## Plugin version
<version, or "unknown">

## Context
<environment, flow/agent IDs, API details, etc.>
```

## Step 2: Check for gh CLI

```bash
which gh
```

## Step 3a: Submit via gh (if available)

```bash
gh issue create \
  --repo ben-elliot-nice/cognigy-plugin-vibe \
  --label "bug" \
  --label "claude-submission" \
  --title "<title>" \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

If `--label "claude-submission"` fails because the label doesn't exist yet, create it first, then retry:

```bash
gh label create "claude-submission" \
  --repo ben-elliot-nice/cognigy-plugin-vibe \
  --description "Filed autonomously by Claude from conversation context" \
  --color "5319e7"
```

Always include:
- `--label "bug"` — every issue filed via this skill is a bug/gap report.
- `--label "claude-submission"` — marks it as Claude-authored so maintainers can filter these apart from user-filed issues.

Report the created issue URL back to the user.

## Step 3b: Manual fallback (if gh not available)

Tell the user `gh` CLI is not installed, then give them the title and body to paste manually at:

https://github.com/ben-elliot-nice/cognigy-plugin-vibe/issues/new

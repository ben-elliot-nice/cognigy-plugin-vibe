/**
 * DEV-ONLY hot-reload constants. Not used by the production server path.
 *
 * Ported from the Python reference implementation's rc=42 respawn sentinel
 * (cognigy_mcp/orchestrator.py + cognigy_mcp/tools/dev_tools.py): the server
 * process exits with this code to ask its supervisor (src/dev/supervisor.ts)
 * to rebuild + respawn it in place, without the MCP client's stdio connection
 * being torn down.
 */
export const RELOAD_EXIT_CODE = 42;

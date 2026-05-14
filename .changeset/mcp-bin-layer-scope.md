---
"@anscribe/mcp": patch
---

Fix `anscribe-mcp` bin closing the libsql client before the first MCP tool call could use it.

// Compatibility entry point.
// Some Render services may still have a manually configured start command that
// launches dist/index.js. Keep that path permanently pointing at the current MCP
// server so an old Render command cannot silently expose the legacy 18-tool schema.
await import("./index-v51.js");

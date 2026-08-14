# GAIIA Unified MCP Server (v2.0.0)

The **GAIIA Unified MCP Server** is an enterprise-grade Model Context Protocol (MCP) server that connects AI coding assistants and autonomous agents to the GAIIA ecosystem. It enables expert-guided code audits, project transformations, BPMN process triggering, and multi-protocol API interrogation.

---

## 🌟 Capabilities & Features

- **Expert Selection & Manifest Routing**: Browse and select from a registry of Proxy Experts (e.g. Clean Architecture, Security, Performance, Transit domain).
- **Code Transformation & Auditing**: Transform individual code blocks or conduct repository-wide audits against immutable architectural standards.
- **Multi-Protocol API Interrogation**: Fuzz and discover schemas across diverse protocols:
  - **REST (JSON)**: OpenAPI v3 synthesis.
  - **GraphQL**: Schema introspection and automatic tool generation.
  - **gRPC (Protobuf)**: Server reflection inspection (`src/mock/mock-grpc-server.ts`).
  - **ISO 8583 (TCP Sockets)**: Raw socket communication for payment gateways (`src/mock/mock-tcp-server.ts`).
  - **XML / SOAP**: Automatic `.xsd` and `.wsdl` parsing.
  - **EDI (ANSI X12)**: Segment repair for legacy enterprise supply chain formats.
  - **OData & ERP**: Enterprise metadata resolution (`src/mock/mock-erp-server.ts`).
- **BPMS Process Orchestration**: List BPMN blueprints and trigger workflow executions in [gaiia-process-management](file:///c:/programming/aiia/gaiia-process-management).
- **Telemetry & Context Retention**: In-memory context tracking and telemetry logging via `src/services/telemetry-service.ts`.

---

## ⚙️ Installation & Build

### Prerequisites
- **Node.js**: v20+ LTS
- **npm**: v9+
- A registered GAIIA account for cloud registry sync

### Setup
```bash
# 1. Navigate to directory
cd gaiia-mcp-server

# 2. Install dependencies
npm install

# 3. Build TypeScript
npm run build
```

---

## 🔐 Authentication

Authenticate with the GAIIA platform to cache session tokens locally:

```bash
npm run login
```

Tokens are cached securely at `~/.gaiia/auth.json`.

---

## 🔧 Environment Configuration (.env)

```env
GAIIA_GRAPHQL_ENDPOINT=https://<api-id>.appsync-api.ap-southeast-2.amazonaws.com/graphql
AWS_REGION=ap-southeast-2
USER_POOL_ID=ap-southeast-2_xxxxxxxxx
APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 🔌 MCP Client Configuration (e.g., Claude Desktop)

Add the server to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gaiia-unified-mcp": {
      "command": "node",
      "args": ["c:/programming/aiia/gaiia-mcp-server/build/index.js"]
    }
  }
}
```

---

## 🛠️ Available MCP Tools Reference

| Tool Name | Purpose | Key Arguments |
|---|---|---|
| `gaiia_list_experts` | Lists all available AI experts in the registry | `query` (optional string: name, email, or architecture keywords) |
| `gaiia_set_active_expert` | Sets the active expert for transformations | `email` (required string) |
| `gaiia_transform` | Audits, refactors, or generates code with the active expert | `code` (string), `instructions` (string) |
| `gaiia_analyze_project` | Performs deep architectural audit or automated refactor on a directory | `directory_path` (string), `mode` ("audit" \| "refactor") |
| `gaiia_ingest_project` | Ingests directory code samples into active expert memory | `directory_path` (string) |
| `interrogate_endpoint` | Multi-protocol API fuzzing and schema synthesis | `url` (string), `method` (string), `auth_header` (optional), `base_payload` (optional) |
| `sync_specs` | Synchronizes locally discovered schemas in `specs/` to cloud registry | *None* |
| `gaiia_list_processes` | Lists registered BPMN templates in the workspace | *None* |
| `gaiia_start_process` | Triggers a BPMN workflow run with initial context | `process_type` (string), `payload` (optional object) |

---

## 🧪 Local Testing & Multi-Protocol Mock Servers

The server includes standalone mock servers in `src/mock/` for testing complex protocols without external dependencies:

```bash
# Start mock gRPC server
npx tsx src/mock/mock-grpc-server.ts

# Start mock ISO 8583 TCP socket server
npx tsx src/mock/mock-tcp-server.ts

# Start mock ERP / OData server
npx tsx src/mock/mock-erp-server.ts
```

---

## 📄 License

MIT © 2026 GAIIA Engineering

# GAIIA Expert Proxy (MCP Server)

GAIIA Expert MCP Server is a Model Context Protocol (MCP) server that enables high-fidelity code audits, refactors, and architectural analysis using specialized Proxy Experts in conjunction with a remote LLM.

## Features

- **Expert Selection**: List and choose from a registry of Proxy Experts with different specialties (e.g., security, performance, architecture).
- **Code Transformation**: Send code blocks to experts for auditing or refactoring based on their specific manifests.
- **Project Analysis**: Perform deep architectural audits or automated repository-wide refactors on local directories.
- **Authentication**: Users must authenticate with their GAIIA account to access the expert registry and processing tasks.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v20 or higher)
- [npm](https://www.npmjs.com/)
- An AIIA Cloud environment (AWS Cognito and AppSync API)

### Steps

1. **Clone or copy** this directory to your machine.
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Build the project**:
   ```bash
   npm run build
   ```

## Configuration

### Authentication

Run the following command to log in and cache your authentication tokens:

```bash
npm run login
```

Follow the prompts to enter your credentials. This will store the session in a local `.gaiia_session` file. If you do not have credentials sing up at https://gaiia.dev.

## Usage with MCP Clients (e.g., Claude Desktop)

Add the following to your MCP settings configuration:

```json
{
  "mcpServers": {
    "gaiia-logic-proxy": {
      "command": "node",
      "args": ["c:/path/to/gaiia-mcp-server/build/index.js"]
    }
  }
}
```

## Available Tools

### `gaiia_list_experts`

Lists all available AI experts in the GAIIA registry.

- **Args**: `query` (optional string) - Search for experts by their email address, name, or specific architectural styles/keywords (e.g., 'Clean Architecture', 'Node.js', 'CQRS').

### `gaiia_set_active_expert`

Sets the expert to be used for subsequent transformations.

- **Args**: `email` (required string)

### `gaiia_transform`

Processes a single block of code with the active expert.

- **Args**: `code`, `instructions`

### `gaiia_analyze_project`

Audits or refactors an entire local directory.

- **Args**: `directory_path`, `mode` ("audit" or "refactor")

## License

MIT

import { spawn } from "child_process";
import fs from "fs";

const PROJECT_PATH = "C:/programming/spring-boot-swagger2-demo";

const requests = [
  {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "gaiia_set_active_expert",
      arguments: {
        email: "dapooley@gmail.com"
      }
    },
    id: 1
  },
  {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "gaiia_analyze_project",
      arguments: {
        directory_path: PROJECT_PATH,
        mode: "refactor"
      }
    },
    id: 2
  }
];

const child = spawn("node", ["build/index.js"], {
  cwd: "c:/programming/aiia/gaiia-mcp-server"
});

let output = "";
child.stdout.on("data", (data) => {
  output += data.toString();
});

child.stderr.on("data", (data) => {
  console.error(`[SERVER LOG] ${data.toString().trim()}`);
});

child.on("close", (code) => {
  const lines = output.split("\n").filter(l => l.trim() !== "");
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      if (response.id === 2) {
        console.log("--- PROJECT REFACTOR RESULT ---");
        if (response.result && response.result.content) {
            const text = response.result.content[0].text;
            console.log(text);
            if (text.includes("refactored and updated 0 files")) {
                console.log("\n--- FULL EXPERT RESPONSE ---");
                // The server code doesn't return the raw processTask, only the synthesized message.
                // I need to modify the server to return the raw result or log it.
            }
        } else if (response.error) {
            console.log(`ERROR: ${response.error.message}`);
        }
      }
    } catch (e) {}
  });
});

requests.forEach(req => {
  child.stdin.write(JSON.stringify(req) + "\n");
});
child.stdin.end();

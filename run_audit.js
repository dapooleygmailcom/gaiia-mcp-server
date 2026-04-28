import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const JAVA_FILE_PATH = "C:/programming/spring-boot-swagger2-demo/src/main/java/com/bennzhang/springboot/swaggerexample/resource/HelloResource.java";
const code = fs.readFileSync(JAVA_FILE_PATH, "utf-8");

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
      name: "gaiia_transform",
      arguments: {
        code: code,
        instructions: "Perform a full audit of this file and provide a change diff with suggested improvements."
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
  // console.error(`stderr: ${data}`);
});

child.on("close", (code) => {
  const lines = output.split("\n").filter(l => l.trim() !== "");
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      if (response.id === 2) {
        console.log("--- TRANSFORMATION RESULT ---");
        console.log(response.result.content[0].text);
      }
    } catch (e) {
      // Not JSON or partial
    }
  });
});

requests.forEach(req => {
  child.stdin.write(JSON.stringify(req) + "\n");
});
child.stdin.end();

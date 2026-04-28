import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const REPO_ROOT = "C:/programming/spring-boot-swagger2-demo";

function getJavaFiles(dir, files = []) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== "target" && file !== ".git") {
        getJavaFiles(fullPath, files);
      }
    } else if (file.endsWith(".java")) {
      files.push(fullPath);
    }
  }
  return files;
}

const javaFiles = getJavaFiles(REPO_ROOT);

async function runMcpSession(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["build/index.js"], {
      cwd: "c:/programming/aiia/gaiia-mcp-server"
    });

    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.on("close", (code) => {
      const results = [];
      const lines = output.split("\n").filter(l => l.trim() !== "");
      lines.forEach(line => {
        try {
          const response = JSON.parse(line);
          results.push(response);
        } catch (e) {}
      });
      resolve(results);
    });

    requests.forEach(req => {
      child.stdin.write(JSON.stringify(req) + "\n");
    });
    child.stdin.end();
  });
}

async function auditAll() {
  console.log(`Starting audit of ${javaFiles.length} files...`);
  
  const results = [];

  for (const file of javaFiles) {
    console.log(`Auditing ${path.basename(file)}...`);
    const code = fs.readFileSync(file, "utf-8");
    
    const sessionRequests = [
      {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "gaiia_set_active_expert",
          arguments: { email: "dapooley@gmail.com" }
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
            instructions: `Perform an architectural audit of this file (${path.basename(file)}) against the Manifesto. Stay in Java.`
          }
        },
        id: 2
      }
    ];

    const sessionResult = await runMcpSession(sessionRequests);
    const transformResult = sessionResult.find(r => r.id === 2);
    
    if (transformResult && transformResult.result) {
      results.push({
        file: path.relative(REPO_ROOT, file),
        audit: transformResult.result.content[0].text
      });
    } else if (transformResult && transformResult.error) {
       results.push({
        file: path.relative(REPO_ROOT, file),
        audit: `ERROR: ${transformResult.error.message}`
      });
    }
  }

  console.log("\n=== REPOSITORY AUDIT COMPLETE ===\n");
  results.forEach(res => {
    console.log(`FILE: ${res.file}`);
    console.log(res.audit);
    console.log("-".repeat(40));
  });
}

auditAll().catch(console.error);

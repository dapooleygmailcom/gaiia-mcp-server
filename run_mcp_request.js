import { spawn } from "child_process";
import fs from "fs";

const request = JSON.parse(fs.readFileSync("test_set_expert.json", "utf-8"));

const child = spawn("node", ["build/index.js"]);

let output = "";
child.stdout.on("data", (data) => {
  output += data.toString();
});

child.stderr.on("data", (data) => {
  // console.error(`stderr: ${data}`);
});

child.on("close", (code) => {
  console.log(output);
});

child.stdin.write(JSON.stringify(request) + "\n");
child.stdin.end();

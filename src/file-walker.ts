import fs from "fs";
import path from "path";

const WHITELIST_EXTENSIONS = [
  ".ts", ".js", ".tsx", ".jsx", ".py", ".java", ".go", ".rs", ".c", ".cpp",
  ".h", ".hpp", ".cs", ".php", ".rb", ".swift", ".kt", ".md", ".json", ".yaml", ".yml"
];

const BLACKLIST_DIRS = [
  "node_modules", ".git", "dist", "build", "target", "bin", "obj", ".vscode", ".idea", "vendor",
  ".next", ".nuxt", ".docusaurus", ".yarn", "out", "coverage", "__pycache__", ".mypy_cache"
];

const BLACKLIST_FILES = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock", "Cargo.lock", "mix.lock", "poetry.lock"
];

export interface FileData {
  path: string;
  content: string;
}

export function walkDirectory(dir: string, baseDir: string = dir): FileData[] {
  const files: FileData[] = [];
  
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      if (BLACKLIST_DIRS.includes(entry.name)) continue;
      files.push(...walkDirectory(fullPath, baseDir));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!WHITELIST_EXTENSIONS.includes(ext)) continue;
      if (BLACKLIST_FILES.includes(entry.name)) continue;
      if (entry.name.endsWith('.min.js') || entry.name.endsWith('.map')) continue;

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        // Limit individual file size to 500KB to prevent memory issues
        const truncatedContent = content.length > 500000 
          ? content.substring(0, 500000) + "\n... [TRUNCATED] ..."
          : content;
          
        files.push({ path: relativePath, content: truncatedContent });
      } catch (err) {
        console.error(`Error reading file ${fullPath}:`, err);
      }
    }
  }

  const totalBytes = files.reduce((acc, f) => acc + f.content.length, 0);
  console.info(`[GAIIA] Walk complete. Found ${files.length} files (${(totalBytes / 1024).toFixed(2)} KB).`);
  return files;
}

export function chunkFiles(files: FileData[], limit: number = 30000): string[] {
  const chunks: string[] = [];
  let currentChunk = "";

  for (const file of files) {
    const fileHeader = `\n--- File: ${file.path} ---\n`;
    
    if (fileHeader.length + file.content.length > limit && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = "";
    }

    if (currentChunk.length + fileHeader.length + file.content.length > limit) {
      chunks.push(currentChunk);
      currentChunk = fileHeader + file.content;
    } else {
      currentChunk += fileHeader + file.content;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  console.info(`[GAIIA] Chunking complete. Created ${chunks.length} chunks.`);
  return chunks;
}

export function writeFileData(baseDir: string, file: FileData): void {
  const fullPath = path.join(baseDir, file.path);
  const dir = path.dirname(fullPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, file.content, "utf-8");
}

export function parseRefactoredContent(content: string): FileData[] {
  const files: FileData[] = [];
  // Regex stops at the next File marker, a horizontal rule (---), or the end of the section
  const regex = /File:\s*([^\s\*]+)[^\n]*\n([\s\S]*?)(?=\n[*\s-]*File:|\n---+\s*\n|$)/gi;
  
  let match;
  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1].replace(/[^\w\d./\\-]/g, "").trim();
    let fileContent = match[2].trim();
    
    if (fileContent.startsWith("```")) {
      fileContent = fileContent.replace(/^```[a-z]*\n?/i, "");
      fileContent = fileContent.replace(/\n?```$/i, "");
    }

    // Skip placeholder instructions or echo-ed text
    if (!filePath || filePath.toLowerCase() === 'path' || filePath.includes('<') || filePath.includes('>')) {
      console.info(`[GAIIA] Skipping placeholder/instruction block: "${filePath}"`);
      continue;
    }

    console.info(`[GAIIA] Parsed refactored file: "${filePath}" (${fileContent.length} bytes)`);
    files.push({ path: filePath, content: fileContent });
  }

  return files;
}

import { execSync } from "child_process";

export function getRepoContext(dir: string): { repoName: string, branch: string } {
  const repoName = path.basename(dir);
  let branch = "local";
  try {
    branch = execSync("git branch --show-current", { cwd: dir }).toString().trim() || "local";
  } catch (e) {
    // Not a git repo or git not installed
  }
  return { repoName, branch };
}

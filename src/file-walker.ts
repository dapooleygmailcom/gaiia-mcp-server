import fs from "fs";
import path from "path";

const WHITELIST_EXTENSIONS = [
  ".ts", ".js", ".tsx", ".jsx", ".py", ".java", ".go", ".rs", ".c", ".cpp",
  ".h", ".hpp", ".cs", ".php", ".rb", ".swift", ".kt", ".md", ".json", ".yaml", ".yml"
];

const BLACKLIST_DIRS = [
  "node_modules", ".git", "dist", "build", "target", "bin", "obj", ".vscode", ".idea", "vendor",
  ".next", ".nuxt", ".docusaurus", ".yarn", "out", "coverage", "__pycache__", ".mypy_cache",
  "assets", "static", "public/assets"
];

const BLACKLIST_FILES = [
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "composer.json", "composer.lock", "pom.xml", "build.gradle",
  "cargo.toml", "cargo.lock", "mix.lock", "poetry.lock", "pyproject.toml",
  "requirements.txt", "gemfile.lock"
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
    const lowerPath = fullPath.toLowerCase();

    if (entry.isDirectory()) {
      if (BLACKLIST_DIRS.includes(entry.name)) continue;
      files.push(...walkDirectory(fullPath, baseDir));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!WHITELIST_EXTENSIONS.includes(ext)) continue;
      if (BLACKLIST_FILES.includes(entry.name)) continue;

      const isAsset = lowerPath.includes('node_modules') || 
                    lowerPath.includes('dist') || 
                    lowerPath.includes('build') || 
                    lowerPath.includes('vendor') || 
                    lowerPath.includes('assets') || 
                    lowerPath.includes('static') ||
                    lowerPath.includes('swagger') ||
                    lowerPath.includes('openapi') ||
                    lowerPath.includes('telemetry');
                    
      const isBundle = lowerPath.includes('bundle') || 
                     lowerPath.includes('preset') ||
                     lowerPath.includes('min.js') ||
                     lowerPath.endsWith('.map');

      if (isAsset || isBundle) continue;

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        // Limit individual file size to 500KB to prevent memory issues
        const truncatedContent = content.length > 500000 
          ? content.substring(0, 500000) + "\n... [TRUNCATED] ..."
          : content;
          
        console.log(`[FILE] ${relativePath} (${content.length} chars)`);
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
  const lines = content.split("\n");
  
  let currentFile: string | null = null;
  let currentContent: string[] = [];

  const fileHeaderRegex = /[#\s\-/]*(?:File:\s*)?([a-zA-Z0-9._/\\-]+\.(?:java|ts|js|py|md|tsx|jsx|go|rs|cpp|h|cs|php|rb|swift|kt|json|yaml|yml))/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(fileHeaderRegex);

    // Check if the line is JUST a file header (or a comment containing only a header)
    // We avoid matching file paths mentioned in sentences by checking line length or prefix
    const isPotentialHeader = match && (line.length < 150) && (line.includes("File:") || line.startsWith("//") || line.startsWith("---") || line.startsWith("#"));

    if (isPotentialHeader && match) {
      if (currentFile && currentContent.length > 0) {
        files.push({ path: currentFile, content: currentContent.join("\n").trim() });
      }
      currentFile = match[1].replace(/[^\w\d./\\-]/g, "").trim();
      currentContent = [];
      // If the next line is a code block start, skip it
      if (lines[i+1] && lines[i+1].trim().startsWith("```")) {
        i++;
      }
    } else if (currentFile) {
      // If we encounter a code block end, we might be at the end of the file
      if (line === "```") continue;
      currentContent.push(lines[i]);
    }
  }

  if (currentFile && currentContent.length > 0) {
    files.push({ path: currentFile, content: currentContent.join("\n").trim() });
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

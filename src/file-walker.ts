import fs from "fs";
import path from "path";

const WHITELIST_EXTENSIONS = [
  ".ts", ".js", ".tsx", ".jsx", ".py", ".java", ".go", ".rs", ".c", ".cpp",
  ".h", ".hpp", ".cs", ".php", ".rb", ".swift", ".kt", ".md", ".json", ".yaml", ".yml"
];

const BLACKLIST_DIRS = [
  "node_modules", ".git", "dist", "build", "target", "bin", "obj", ".vscode", ".idea", "vendor"
];

const BLACKLIST_FILES = [
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock", "Cargo.lock"
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

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        // Limit individual file size to 100KB to prevent memory issues
        const truncatedContent = content.length > 100000 
          ? content.substring(0, 100000) + "\n... [TRUNCATED] ..."
          : content;
          
        files.push({ path: relativePath, content: truncatedContent });
      } catch (err) {
        console.error(`Error reading file ${fullPath}:`, err);
      }
    }
  }

  return files;
}

export function chunkFiles(files: FileData[], limit: number = 40000): string[] {
  const chunks: string[] = [];
  let currentChunk = "";

  for (const file of files) {
    const fileHeader = `\n--- File: ${file.path} ---\n`;
    
    // If a single file exceeds the limit, it will be its own chunk (already truncated in walk)
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
  // Look for markers like --- File: path ---, handle optional newlines and spaces
  const fileBlocks = content.split(/\n?--- File: (.*?) ---\n?/);
  
  // split will return [textBeforeFirstMatch, match1, textBetween1And2, match2, ...]
  for (let i = 1; i < fileBlocks.length; i += 2) {
    const filePath = fileBlocks[i].trim();
    const fileContent = fileBlocks[i + 1]?.trim() || "";
    if (filePath) {
      console.info(`[GAIIA] Found refactored file: ${filePath} (${fileContent.length} bytes)`);
      files.push({ path: filePath, content: fileContent });
    }
  }

  return files;
}

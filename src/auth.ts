import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline/promises";

const USER_POOL_ID = "ap-southeast-2_JxCoad8W1";
const CLIENT_ID = "1k5bhgimd8i7dtm7cjkl0h0r";
const REGION = "ap-southeast-2";
const CONFIG_DIR = path.join(os.homedir(), ".gaiia");
const AUTH_FILE = path.join(CONFIG_DIR, "auth.json");

const client = new CognitoIdentityProviderClient({ region: REGION });

async function login() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("--- GAIIA Authentication ---");
  const email = await rl.question("Email: ");
  const password = await rl.question("Password: ");
  rl.close();

  try {
    const command = new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const response = await client.send(command);
    
    if (response.AuthenticationResult) {
      const { AccessToken, RefreshToken, ExpiresIn } = response.AuthenticationResult;
      
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }

      const authData = {
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        expiresAt: Date.now() + (ExpiresIn || 3600) * 1000,
        email,
      };

      fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2));
      console.log("\n[SUCCESS] Authenticated successfully. Tokens saved to ~/.gaiia/auth.json");
    }
  } catch (error: any) {
    console.error("\n[ERROR] Authentication failed:", error.message);
    process.exit(1);
  }
}

export function getAccessToken(): string | null {
  if (!fs.existsSync(AUTH_FILE)) return null;
  
  try {
    const authData = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    if (Date.now() > authData.expiresAt) {
      console.warn("[WARN] GAIIA Access Token has expired. Please run 'npm run login' again.");
      return null;
    }
    return authData.accessToken;
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
if (args[0] === "login") {
  login();
}

import { unlink } from "node:fs/promises";
import path from "node:path";
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { openaiCredentials } from "@openai-oauth/local";
import { runOpenAIOAuthLogin } from "openai-oauth";

// Kept separate from ~/.codex so logging out here doesn't log out the Codex CLI.
const authFilePath = path.resolve(process.env.OPENAI_AUTH_FILE ?? ".openai-auth.json");

const credentials = () => openaiCredentials({ authFilePath });
export const openai = () => createOpenAIOAuth(credentials());

export async function isSignedIn() {
  try {
    return Boolean(await credentials().getSession());
  } catch {
    return false;
  }
}

export async function logout() {
  await unlink(authFilePath).catch(() => {});
}

let pending: Promise<string> | undefined;
let loginError: string | undefined;

/** Starts the OAuth flow (callback on localhost:1455) and resolves with the URL to open. */
export function startLogin() {
  pending ??= new Promise<string>((resolve, reject) => {
    loginError = undefined;
    runOpenAIOAuthLogin({
      authFilePath,
      openBrowser: false,
      // In Docker the callback server must listen on all interfaces so the published port is reachable.
      host: process.env.OPENAI_LOGIN_LISTEN_HOST || undefined,
      onMessage: (message) => {
        const url = message.match(/https?:\/\/\S+/)?.[0];
        if (url && message.includes("login URL")) resolve(url);
      },
    })
      .catch((error: Error) => {
        loginError = error.message;
        reject(error);
      })
      .finally(() => {
        pending = undefined;
      });
  });
  return pending;
}

export const getLoginError = () => loginError;

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { PrismaClient, User } from "./generated/prisma/client.ts";

export function getFirebaseConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY ?? "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.FIREBASE_PROJECT_ID ?? "",
    appId: process.env.FIREBASE_APP_ID ?? "",
  };
}

export const isAuthConfigured = () => Object.values(getFirebaseConfig()).every((value) => value.trim().length > 0);
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
export type GoogleIdentity = { uid: string; email: string; name: string | null };

/** Public-key verification only: no service-account credentials or client role claims. */
export function createFirebaseAuth({ projectId, keys = googleKeys }: { projectId?: string; keys?: JWTVerifyGetKey }) {
  return {
    async verify(token: string | undefined): Promise<GoogleIdentity | null> {
      if (!projectId?.trim() || !token) return null;
      try {
        const { payload, protectedHeader } = await jwtVerify(token, keys, {
          algorithms: ["RS256"], issuer: `https://securetoken.google.com/${projectId}`, audience: projectId,
          requiredClaims: ["exp", "iat", "auth_time", "sub", "email", "email_verified", "firebase"],
        });
        const now = Math.floor(Date.now() / 1000);
        if (!protectedHeader.kid || payload.aud !== projectId || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128 ||
          typeof payload.iat !== "number" || payload.iat > now ||
          typeof payload.auth_time !== "number" || payload.auth_time > now ||
          payload.email_verified !== true || typeof payload.email !== "string" ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
          !payload.firebase || typeof payload.firebase !== "object" ||
          !("sign_in_provider" in payload.firebase) || payload.firebase.sign_in_provider !== "google.com") return null;
        return { uid: payload.sub, email: payload.email.toLowerCase(), name: typeof payload.name === "string" ? payload.name : null };
      } catch {
        return null;
      }
    },
  };
}

export function bearerToken(header: string | string[] | undefined): string | undefined {
  return typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header)?.[1] : undefined;
}

/** Only an unlinked seed may be claimed by email; an existing Firebase binding is immutable. */
export async function resolveGoogleUser(db: PrismaClient, identity: GoogleIdentity): Promise<User> {
  const resolve = () => db.$transaction(async (tx) => {
    const bound = await tx.user.findUnique({ where: { authSubject: identity.uid } });
    if (bound) return tx.user.update({ where: { id: bound.id }, data: { lastLoginAt: new Date() } });
    const seeded = await tx.user.findUnique({ where: { email: identity.email } });
    if (seeded) {
      const linked = await tx.user.updateMany({
        where: { id: seeded.id, authSubject: null },
        data: { authSubject: identity.uid, lastLoginAt: new Date(), ...(seeded.name === null ? { name: identity.name } : {}) },
      });
      if (linked.count !== 1) throw new Error("This email is already linked to another account.");
      return tx.user.findUniqueOrThrow({ where: { id: seeded.id } });
    }
    return tx.user.create({ data: { email: identity.email, authSubject: identity.uid, name: identity.name, role: "MEMBER", lastLoginAt: new Date() } });
  });
  try {
    return await resolve();
  } catch (error) {
    // Concurrent initial requests may race on a unique key; retry the full transaction once.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return resolve();
    throw error;
  }
}

export async function authenticateRequest(db: PrismaClient, authorization: string | string[] | undefined): Promise<User | null> {
  if (!isAuthConfigured()) return null;
  const identity = await createFirebaseAuth({ projectId: process.env.FIREBASE_PROJECT_ID }).verify(bearerToken(authorization));
  return identity ? resolveGoogleUser(db, identity) : null;
}

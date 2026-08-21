"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AuthError,
  createSession,
  destroySession,
  signIn,
  signUp,
  validateSession,
} from "@/server/domain/auth";

const SESSION_COOKIE = "market_os_session";

async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(token);
}

export interface AuthFormState {
  error?: string;
}

export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    const user = await signUp(email, password);
    const session = await createSession(user.id);
    await setSessionCookie(session.id, session.expiresAt);
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: err.message };
    }
    throw err;
  }

  redirect("/today");
}

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    const user = await signIn(email, password);
    const session = await createSession(user.id);
    await setSessionCookie(session.id, session.expiresAt);
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: err.message };
    }
    throw err;
  }

  redirect("/today");
}

export async function signOutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await destroySession(token);
  }
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

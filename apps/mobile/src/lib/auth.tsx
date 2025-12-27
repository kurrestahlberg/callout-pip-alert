import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import {
  CognitoUserPool,
  CognitoUser,
  CognitoUserAttribute,
  AuthenticationDetails,
  CognitoUserSession,
  CognitoRefreshToken,
} from "amazon-cognito-identity-js";
import { LazyStore } from "@tauri-apps/plugin-store";
import { open } from "@tauri-apps/plugin-opener";
import { getActiveBackend, initializeDefaultBackend, AuthMode } from "./backends";
import {
  storeCredentials,
  clearStoredCredentials,
  getStoredCredentials,
  isBiometricEnabled,
  authenticateWithBiometric,
  checkBiometricAvailability,
  getBiometryTypeName,
} from "./biometric";

function getCognitoConfig() {
  const backend = getActiveBackend();
  if (backend) {
    return {
      userPoolId: backend.userPoolId,
      clientId: backend.userPoolClientId,
      region: backend.region,
      authMode: (backend.authMode ?? "password") as AuthMode,
      cognitoDomain: backend.cognitoDomain || "",
      redirectUri: backend.redirectUri || "",
      scopes: backend.scopes,
    };
  }
  // Fallback to env vars
  return {
    userPoolId: import.meta.env.VITE_USER_POOL_ID || import.meta.env.VITE_COGNITO_USER_POOL_ID || "",
    clientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || import.meta.env.VITE_COGNITO_CLIENT_ID || "",
    region: import.meta.env.VITE_AWS_REGION || import.meta.env.VITE_COGNITO_REGION || "eu-west-1",
    authMode: (import.meta.env.VITE_AUTH_MODE as AuthMode) || "password",
    cognitoDomain: import.meta.env.VITE_COGNITO_DOMAIN || "",
    redirectUri: import.meta.env.VITE_COGNITO_REDIRECT_URI || import.meta.env.VITE_REDIRECT_URI || "",
    scopes:
      typeof import.meta.env.VITE_OIDC_SCOPES === "string"
        ? import.meta.env.VITE_OIDC_SCOPES.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
  };
}

function createUserPool() {
  const config = getCognitoConfig();
  if (!config.userPoolId || !config.clientId) {
    return null;
  }
  return new CognitoUserPool({
    UserPoolId: config.userPoolId,
    ClientId: config.clientId,
  });
}

interface AuthContextType {
  user: CognitoUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  authMode: AuthMode;
  startOidcLogin: () => Promise<void>;
  completeOidcLoginFromUrl: (url: string) => Promise<boolean>;
  canUseBiometric: boolean;
  biometricType: string;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithBiometric: () => Promise<boolean>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CognitoUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [canUseBiometric, setCanUseBiometric] = useState(false);
  const [biometricType, setBiometricType] = useState("Biometrics");
  const [oidcHandled, setOidcHandled] = useState(false);

  // Initialize default backend from env vars on first load
  useEffect(() => {
    initializeDefaultBackend();
  }, []);

  const config = useMemo(() => getCognitoConfig(), []);
  const userPool = useMemo(() => createUserPool(), []);
  const isConfigured = !!userPool;

  useEffect(() => {
    setAuthMode(config.authMode);
  }, [config.authMode]);

  // Check biometric availability
  useEffect(() => {
    async function checkBiometric() {
      const status = await checkBiometricAvailability();
      const enabled = await isBiometricEnabled();
      const hasCredentials = await getStoredCredentials();

      setCanUseBiometric(status.available && enabled && hasCredentials !== null);
      setBiometricType(getBiometryTypeName(status.biometryType));
    }
    checkBiometric();
  }, []);

  useEffect(() => {
    if (!userPool) {
      setIsLoading(false);
      return;
    }

    if (authMode === "oidc") {
      // Try to hydrate from stored tokens
      (async () => {
        try {
          const store = new LazyStore("auth.json");
          const idToken = await store.get<string>("idToken");
          if (idToken) {
            setUser(
              new CognitoUser({
                Username: "oidc-user",
                Pool: userPool,
              })
            );
          }
        } catch (e) {
          console.warn("Failed to hydrate OIDC session:", e);
        } finally {
          setIsLoading(false);
        }
      })();
      return;
    }

    // Password/SRP path: check for existing session
    const currentUser = userPool.getCurrentUser();
    if (currentUser) {
      currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session?.isValid()) {
          setUser(null);
        } else {
          setUser(currentUser);
        }
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, [authMode, userPool]);

  // Handle Hosted UI callback (only once)
  useEffect(() => {
    if (authMode !== "oidc" || oidcHandled) return;
    const href = window.location.href;
    if (href.includes("code=")) {
      completeOidcLoginFromUrl(href).then((success) => {
        if (success) {
          // Strip query to avoid reprocessing
          const cleanUrl = href.split("?")[0];
          window.history.replaceState({}, document.title, cleanUrl);
        }
        setIsLoading(false);
        setOidcHandled(true);
      });
    } else {
      setOidcHandled(true);
    }
  }, [authMode, completeOidcLoginFromUrl, oidcHandled]);

  // PKCE helpers (simple in-memory for the session)
  const pkceState = useMemo(() => {
    const buf = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }, []);

  async function sha256(input: string) {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  const pkceStore = useMemo(() => new LazyStore("pkce.json"), []);

  async function makePkce() {
    const verifierBytes = crypto.getRandomValues(new Uint8Array(64));
    const verifier = btoa(String.fromCharCode(...verifierBytes))
      .replace(/\+/g, "A")
      .replace(/\//g, "B")
      .replace(/=+$/, "");
    const challenge = await sha256(verifier);
    return { verifier, challenge };
  }

  const startOidcLogin = useCallback(async () => {
    if (config.authMode !== "oidc") {
      throw new Error("OIDC login not enabled for this backend");
    }
    if (!config.cognitoDomain || !config.redirectUri) {
      throw new Error("OIDC backend missing cognitoDomain or redirectUri");
    }

    const { verifier, challenge } = await makePkce();
    await pkceStore.set("verifier", verifier);
    await pkceStore.set("state", pkceState);
    await pkceStore.save();

    const scopes = (config.scopes && config.scopes.length > 0 ? config.scopes : ["openid", "email", "profile"]).join("+");
    const url =
      `${config.cognitoDomain.replace(/\/$/, "")}/oauth2/authorize?` +
      `client_id=${encodeURIComponent(config.clientId)}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(config.redirectUri)}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `code_challenge=${challenge}&code_challenge_method=S256&state=${pkceState}`;

    await open(url);
  }, [config.authMode, config.cognitoDomain, config.redirectUri, config.clientId, config.scopes, pkceState, pkceStore]);

  const exchangeCodeForTokens = useCallback(
    async (code: string, state: string) => {
      if (!config.cognitoDomain || !config.redirectUri) {
        throw new Error("OIDC backend missing cognitoDomain or redirectUri");
      }
      const storedState = await pkceStore.get<string>("state");
      if (!storedState || storedState !== state) {
        throw new Error("State mismatch");
      }
      const verifier = await pkceStore.get<string>("verifier");
      if (!verifier) {
        throw new Error("Missing PKCE verifier");
      }

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        code,
        code_verifier: verifier,
      });

      const res = await fetch(`${config.cognitoDomain.replace(/\/$/, "")}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed: ${text}`);
      }
      const tokens = await res.json();

      // Store tokens securely
      const store = new LazyStore("auth.json");
      await store.set("idToken", tokens.id_token);
      await store.set("accessToken", tokens.access_token);
      if (tokens.refresh_token) {
        await store.set("refreshToken", tokens.refresh_token);
        await storeCredentials("oidc-user", tokens.refresh_token);
      }
      await store.save();
      await pkceStore.clear();
      await pkceStore.save();

      // We don't have a CognitoUser for hosted UI tokens, so create a lightweight user object
      setUser(
        new CognitoUser({
          Username: "oidc-user",
          Pool: userPool!,
        })
      );
    },
    [config.clientId, config.cognitoDomain, config.redirectUri, pkceStore, userPool]
  );

  const completeOidcLoginFromUrl = useCallback(
    async (url: string) => {
      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get("code");
        const state = parsed.searchParams.get("state");
        if (!code || !state) {
          return false;
        }
        await exchangeCodeForTokens(code, state);
        return true;
      } catch (e) {
        console.warn("Failed to complete OIDC login:", e);
        return false;
      }
    },
    [exchangeCodeForTokens]
  );

  const signIn = useCallback(async (email: string, password: string) => {
    if (authMode !== "password") {
      throw new Error("Password auth disabled for this backend");
    }
    if (!userPool) {
      throw new Error("No backend configured. Please add a backend in Settings.");
    }

    return new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool,
      });

      const authDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: async (session) => {
          setUser(cognitoUser);
          // Store tokens securely
          try {
            const store = new LazyStore("auth.json");
            await store.set("idToken", session.getIdToken().getJwtToken());
            await store.set("accessToken", session.getAccessToken().getJwtToken());
            await store.set("refreshToken", session.getRefreshToken().getToken());
            await store.save();

            // Store credentials for biometric login
            await storeCredentials(email, session.getRefreshToken().getToken());
          } catch (e) {
            console.warn("Failed to store tokens:", e);
          }
          resolve();
        },
        onFailure: (err) => {
          reject(err);
        },
        newPasswordRequired: () => {
          reject(new Error("New password required"));
        },
      });
    });
  }, [userPool]);

  const signInWithBiometric = useCallback(async (): Promise<boolean> => {
    if (!userPool) {
      return false;
    }

    // Check if biometric is enabled and we have stored credentials
    const enabled = await isBiometricEnabled();
    if (!enabled) {
      return false;
    }

    const credentials = await getStoredCredentials();
    if (!credentials) {
      return false;
    }

    // Authenticate with biometric
    const authenticated = await authenticateWithBiometric("Sign in to Pip-Alert");
    if (!authenticated) {
      return false;
    }

    // Use refresh token to get new session
    // OIDC path: use refresh token at token endpoint
    if (authMode === "oidc") {
      if (!config.cognitoDomain) {
        return false;
      }
      return new Promise<boolean>(async (resolve) => {
        const body = new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId,
          refresh_token: credentials.refreshToken,
        });
        try {
          const res = await fetch(`${config.cognitoDomain.replace(/\/$/, "")}/oauth2/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          });
          if (!res.ok) {
            await clearStoredCredentials();
            resolve(false);
            return;
          }
          const tokens = await res.json();
          const store = new LazyStore("auth.json");
          await store.set("idToken", tokens.id_token);
          await store.set("accessToken", tokens.access_token);
          if (tokens.refresh_token) {
            await store.set("refreshToken", tokens.refresh_token);
            await storeCredentials(credentials.email, tokens.refresh_token);
          }
          await store.save();
          setUser(
            new CognitoUser({
              Username: credentials.email,
              Pool: userPool,
            })
          );
          resolve(true);
        } catch {
          await clearStoredCredentials();
          resolve(false);
        }
      });
    }

    // Password/SRP path
    return new Promise<boolean>((resolve) => {
      const cognitoUser = new CognitoUser({
        Username: credentials.email,
        Pool: userPool,
      });

      const refreshToken = new CognitoRefreshToken({
        RefreshToken: credentials.refreshToken,
      });

      cognitoUser.refreshSession(refreshToken, async (err, session) => {
        if (err || !session) {
          // Refresh token expired or invalid, clear stored credentials
          await clearStoredCredentials();
          resolve(false);
          return;
        }

        setUser(cognitoUser);

        // Update stored tokens
        try {
          const store = new LazyStore("auth.json");
          await store.set("idToken", session.getIdToken().getJwtToken());
          await store.set("accessToken", session.getAccessToken().getJwtToken());
          await store.set("refreshToken", session.getRefreshToken().getToken());
          await store.save();

          // Update stored refresh token
          await storeCredentials(credentials.email, session.getRefreshToken().getToken());
        } catch (e) {
          console.warn("Failed to store tokens:", e);
        }

        resolve(true);
      });
    });
  }, [authMode, config.cognitoDomain, config.clientId, userPool]);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    if (authMode !== "password") {
      throw new Error("Sign up disabled for this backend");
    }
    if (!userPool) {
      throw new Error("No backend configured. Please add a backend in Settings.");
    }

    return new Promise<void>((resolve, reject) => {
      const attributeList = [
        new CognitoUserAttribute({ Name: "name", Value: name }),
      ];
      userPool.signUp(
        email,
        password,
        attributeList,
        [],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }, [userPool]);

  const confirmSignUp = useCallback(async (email: string, code: string) => {
    if (authMode !== "password") {
      throw new Error("Confirm sign up disabled for this backend");
    }
    if (!userPool) {
      throw new Error("No backend configured. Please add a backend in Settings.");
    }

    return new Promise<void>((resolve, reject) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool,
      });

      cognitoUser.confirmRegistration(code, true, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }, [userPool]);

  const signOut = useCallback(async () => {
    if (user) {
      user.signOut();
    }
    // Clear stored tokens
    try {
      const store = new LazyStore("auth.json");
      await store.clear();
      await store.save();
      const pkce = new LazyStore("pkce.json");
      await pkce.clear();
      await pkce.save();
      // Note: We don't clear biometric credentials on sign out
      // so user can still use biometric to sign back in
    } catch (e) {
      console.warn("Failed to clear tokens:", e);
    }
    setUser(null);
  }, [user]);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (authMode === "oidc") {
      try {
        const store = new LazyStore("auth.json");
        const idToken = await store.get<string>("idToken");
        if (idToken) return idToken;
      } catch (e) {
        console.warn("Failed to read token:", e);
      }
      return null;
    }

    return new Promise((resolve) => {
      if (!user) {
        resolve(null);
        return;
      }

      user.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session?.isValid()) {
          resolve(null);
        } else {
          resolve(session.getIdToken().getJwtToken());
        }
      });
    });
  }, [authMode, user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        isConfigured,
        authMode,
        startOidcLogin,
        completeOidcLoginFromUrl,
        canUseBiometric,
        biometricType,
        signIn,
        signInWithBiometric,
        signUp,
        confirmSignUp,
        signOut,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

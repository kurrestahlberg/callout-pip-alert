import { useEffect, useState, useCallback, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  registerForPushNotifications,
  onNotificationReceived,
} from "@choochmeque/tauri-plugin-notifications-api";
import { load } from "@tauri-apps/plugin-store";
import { devicesApi } from "../lib/api";

interface PushNotificationState {
  token: string | null;
  isRegistered: boolean;
  error: string | null;
  status: "pending" | "loading" | "checking" | "requesting" | "registering" | "granted" | "denied" | "error";
}

interface UsePushNotificationsOptions {
  onPushReceived?: () => void; // Callback when push received in foreground
  debounceMs?: number; // Debounce delay for callback (default 500ms)
}

const PUSH_STORE_KEY = "push_device_token";

// Timeout wrapper for promises that might hang
function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms)),
  ]);
}

export function usePushNotifications(
  isAuthenticated: boolean,
  options: UsePushNotificationsOptions = {}
) {
  const { onPushReceived, debounceMs = 500 } = options;
  const [state, setState] = useState<PushNotificationState>({
    token: null,
    isRegistered: false,
    error: null,
    status: "pending",
  });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canFireRef = useRef(true); // For leading-edge debounce
  const onPushReceivedRef = useRef(onPushReceived);

  // Keep callback ref up to date
  useEffect(() => {
    onPushReceivedRef.current = onPushReceived;
  }, [onPushReceived]);

  // Leading-edge debounce: fires immediately on first call, ignores subsequent until quiet
  const debouncedPushHandler = useCallback(() => {
    if (canFireRef.current && onPushReceivedRef.current) {
      console.log("[Push] Foreground notification - triggering refresh");
      onPushReceivedRef.current();
      canFireRef.current = false;
    } else {
      console.log("[Push] Foreground notification - debounced");
    }

    // Reset the timer on each call
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      canFireRef.current = true;
    }, debounceMs);
  }, [debounceMs]);

  // Listen for foreground push notifications (only after registration complete)
  useEffect(() => {
    // Don't set up listener until we have a token and are registered
    if (!state.token || !state.isRegistered) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let isMounted = true;

    const setupListener = async () => {
      try {
        // Small delay to ensure native side is ready
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!isMounted) return;

        const listener = await withTimeout(
          onNotificationReceived((notification) => {
            console.log("[Push] Notification received:", notification.title);
            debouncedPushHandler();
          }),
          3000,
          "Notification listener setup timed out"
        );
        if (isMounted) {
          unlisten = () => listener.unregister();
          console.log("[Push] Foreground notification listener registered");
        } else {
          listener.unregister();
        }
      } catch (error) {
        console.error("[Push] Failed to setup notification listener:", error);
      }
    };

    setupListener();

    return () => {
      isMounted = false;
      if (unlisten) unlisten();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [state.token, state.isRegistered, debouncedPushHandler]);

  // Load stored token or request new one
  useEffect(() => {
    let isMounted = true;

    const initPushNotifications = async () => {
      try {
        // Step 1: Try to load stored token first
        setState((prev) => ({ ...prev, status: "loading" }));
        console.log("[Push] Loading stored token...");

        try {
          const store = await load("push.json");
          const storedToken = await store.get<string>(PUSH_STORE_KEY);

          if (storedToken && typeof storedToken === "string" && storedToken.length > 0) {
            console.log("[Push] Found stored token:", storedToken.substring(0, 20) + "...");
            if (isMounted) {
              setState((prev) => ({ ...prev, token: storedToken, error: null, status: "granted" }));
            }
            return; // We have a token, no need to request again
          }
          console.log("[Push] No stored token found");
        } catch (e) {
          console.warn("[Push] Failed to load stored token:", e);
        }

        if (!isMounted) return;

        // Step 2: Check if permission is already granted
        setState((prev) => ({ ...prev, status: "checking" }));
        console.log("[Push] Checking permission status...");

        let hasPermission = false;
        try {
          hasPermission = await withTimeout(isPermissionGranted(), 5000, "Permission check timed out");
          console.log("[Push] Permission granted:", hasPermission);
        } catch (e) {
          console.warn("[Push] Permission check failed:", e);
        }

        if (!isMounted) return;

        // Step 3: Request permission if not granted
        if (!hasPermission) {
          setState((prev) => ({ ...prev, status: "requesting" }));
          console.log("[Push] Requesting permission...");

          try {
            const permResult = await withTimeout(requestPermission(), 30000, "Permission request timed out");
            console.log("[Push] Permission result:", permResult);
            hasPermission = permResult === "granted";
          } catch (e) {
            console.warn("[Push] Permission request failed:", e);
          }
        }

        if (!isMounted) return;

        if (!hasPermission) {
          console.warn("[Push] Permission not granted");
          setState((prev) => ({
            ...prev,
            error: "Notification permission not granted",
            status: "denied",
          }));
          return;
        }

        // Step 4: Register for push notifications to get token
        setState((prev) => ({ ...prev, status: "registering" }));
        console.log("[Push] Registering for push notifications...");

        const token = await withTimeout(
          registerForPushNotifications(),
          10000,
          "Push registration timed out"
        );

        if (!isMounted) return;

        console.log("[Push] registerForPushNotifications returned:", token ? `token (${token.length} chars)` : "null/undefined");

        if (token && typeof token === "string" && token.length > 0) {
          console.log("[Push] Received device token:", token.substring(0, 20) + "...");

          // Store the token for future use
          try {
            const store = await load("push.json");
            await store.set(PUSH_STORE_KEY, token);
            await store.save();
            console.log("[Push] Token stored successfully");
          } catch (e) {
            console.warn("[Push] Failed to store token:", e);
          }

          setState((prev) => ({ ...prev, token, error: null, status: "granted" }));
        } else {
          console.warn("[Push] No token returned");
          setState((prev) => ({
            ...prev,
            error: "No token received from APNs",
            status: "error",
          }));
        }
      } catch (error) {
        if (!isMounted) return;

        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[Push] Failed to register for push notifications:", errorMessage);
        setState((prev) => ({
          ...prev,
          error: errorMessage,
          status: "error",
        }));
      }
    };

    initPushNotifications();

    return () => {
      isMounted = false;
    };
  }, []);

  // Register token with backend when authenticated and we have a token
  useEffect(() => {
    if (!isAuthenticated || !state.token || state.isRegistered) {
      return;
    }

    const registerDevice = async () => {
      try {
        // Use sandbox for dev builds, production for release builds
        const isSandbox = import.meta.env.DEV;
        console.log(`[Push] Registering device with backend (sandbox: ${isSandbox})...`);
        await devicesApi.register(state.token!, "ios", isSandbox);
        setState((prev) => ({ ...prev, isRegistered: true, error: null }));
        console.log("[Push] Device registered successfully");
      } catch (error) {
        console.error("[Push] Failed to register device:", error);
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : "Registration failed",
        }));
      }
    };

    registerDevice();
  }, [isAuthenticated, state.token, state.isRegistered]);

  // Unregister device on logout
  const unregisterDevice = useCallback(async () => {
    if (!state.token) return;

    try {
      await devicesApi.unregister(state.token);
      setState((prev) => ({ ...prev, isRegistered: false }));
      console.log("[Push] Device unregistered");
    } catch (error) {
      console.error("[Push] Failed to unregister device:", error);
    }
  }, [state.token]);

  // Clear stored token (for debugging/reset)
  const clearStoredToken = useCallback(async () => {
    try {
      const store = await load("push.json");
      await store.delete(PUSH_STORE_KEY);
      await store.save();
      setState((prev) => ({ ...prev, token: null, isRegistered: false, status: "pending" }));
      console.log("[Push] Stored token cleared");
    } catch (error) {
      console.error("[Push] Failed to clear stored token:", error);
    }
  }, []);

  return {
    token: state.token,
    isRegistered: state.isRegistered,
    error: state.error,
    status: state.status,
    unregisterDevice,
    clearStoredToken,
  };
}

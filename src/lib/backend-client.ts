"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";

export function useBackendClient() {
  const { getToken } = useAuth();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getToken();
      const headers = new Headers(init.headers);
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
      }

      return fetch(`${backendUrl}${path}`, { ...init, headers });
    },
    [backendUrl, getToken],
  );

  return { request };
}

import { auth } from "../utils/firebase.js";

export class ApiError extends Error {
  constructor(status, code, message, requestId = null, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

async function getIdToken(forceRefresh = false) {
  if (auth.currentUser) {
    try {
      return await auth.currentUser.getIdToken(forceRefresh);
    } catch {
      return null;
    }
  }
  return null;
}

export function getBaseUrl() {
  const raw = import.meta.env.VITE_API_URL || "http://localhost:8000";
  return raw.replace(/\/+$/, "");
}

export async function apiFetch(path, init = {}) {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  let token = await getIdToken(false);

  async function executeCall(authToken) {
    const headers = {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    };

    const res = await fetch(url, {
      method: init.method || "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      credentials: "include",
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }

    if (!res.ok) {
      const errEnvelope = json?.error || {};
      const code = errEnvelope.code || (res.status === 401 ? "UNAUTHENTICATED" : (res.status === 404 ? "NOT_FOUND" : "NETWORK_ERROR"));
      const message = errEnvelope.message || json?.message || `Request failed with status ${res.status}`;
      const requestId = errEnvelope.requestId || res.headers.get("x-request-id") || null;
      const details = errEnvelope.details;
      throw new ApiError(res.status, code, message, requestId, details);
    }

    return json || { data: null };
  }

  try {
    return await executeCall(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Retry once with refreshed token
      const freshToken = await getIdToken(true);
      if (freshToken && freshToken !== token) {
        return await executeCall(freshToken);
      }
    }
    throw err;
  }
}

export function uploadWithProgress(path, file, onProgress, signal) {
  return new Promise((resolve, reject) => {
    getIdToken(false).then((token) => {
      const baseUrl = getBaseUrl();
      const url = `${baseUrl}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
      const xhr = new XMLHttpRequest();

      xhr.open("POST", url, true);
      xhr.withCredentials = true;
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      if (signal) {
        signal.addEventListener("abort", () => {
          xhr.abort();
          reject(new ApiError(0, "JOB_CANCELLED", "The upload was cancelled."));
        });
      }

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && onProgress) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          onProgress(pct);
        }
      };

      xhr.onload = () => {
        let json;
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          json = null;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(json?.data || json);
        } else {
          const errEnvelope = json?.error || {};
          const code = errEnvelope.code || (xhr.status === 413 ? "FILE_TOO_LARGE" : "UNPROCESSABLE");
          const message = errEnvelope.message || "Upload failed.";
          const requestId = errEnvelope.requestId || xhr.getResponseHeader("x-request-id") || null;
          reject(new ApiError(xhr.status, code, message, requestId, errEnvelope.details));
        }
      };

      xhr.onerror = () => {
        reject(new ApiError(0, "NETWORK_ERROR", "Upload failed due to network error."));
      };

      const formData = new FormData();
      formData.append("file", file);
      xhr.send(formData);
    }).catch(reject);
  });
}

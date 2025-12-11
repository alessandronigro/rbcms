const fallbackBackendUrl =
  typeof window === "undefined"
    ? ""
    : `${window.location.protocol}//${window.location.host}`;

export const backendUrl = (import.meta.env.VITE_BACKEND_URL ?? fallbackBackendUrl).replace(/\/$/, "");

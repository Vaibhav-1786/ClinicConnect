import axios from "axios";

const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("role");
      sessionStorage.removeItem("profile");
      sessionStorage.removeItem("clinic");
      sessionStorage.removeItem("organizations");
      if (!window.location.pathname.includes("/login")) {
        window.location.href = "/";
      }
    }
    // A request with no `response` at all means it never reached the server
    // (offline, DNS failure, etc). For anything other than a plain GET, that
    // matters: we must never let the app silently pretend a check-in, status
    // change, or any other write "succeeded" while offline, nor silently
    // queue it for later — see README section 1, Phase 7c. Attaching a clear
    // synthetic error here means every existing `catch` block across the app
    // that already reads `err.response?.data?.error` shows a correct message
    // with zero per-page changes.
    if (!err.response && err.config && err.config.method !== "get") {
      err.response = {
        status: 0,
        data: { error: navigator.onLine === false
          ? "You're offline. This action needs a connection — please reconnect and try again."
          : "Could not reach the server. Please check your connection and try again." },
      };
    }
    return Promise.reject(err);
  }
);

export default api;
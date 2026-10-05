import type { NextConfig } from "next";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
if (process.env.NODE_ENV === "production") {
  if (!apiBaseUrl) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must be set for production builds.");
  }
  let parsedApiBaseUrl: URL;
  try {
    parsedApiBaseUrl = new URL(apiBaseUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must be an absolute HTTP(S) URL.");
  }
  const localApiHost = ["localhost", "127.0.0.1"].includes(parsedApiBaseUrl.hostname);
  if (parsedApiBaseUrl.username || parsedApiBaseUrl.password || parsedApiBaseUrl.search || parsedApiBaseUrl.hash) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must not contain credentials, a query, or a fragment.");
  }
  if (parsedApiBaseUrl.pathname !== "/" && parsedApiBaseUrl.pathname !== "") {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must be an origin without a path.");
  }
  if (parsedApiBaseUrl.protocol !== "https:" && !(localApiHost && parsedApiBaseUrl.protocol === "http:")) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must use HTTPS outside local development.");
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    ];
    if (process.env.NODE_ENV === "production") {
      headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
    }
    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;

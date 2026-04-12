const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

function createGoogleDriveManager(options = {}) {
  const appRoot = options.appRoot || process.cwd();
  const dataDir = options.dataDir || path.join(appRoot, "data");
  const defaultClientId = String(options.defaultClientId || "").trim();
  const defaultClientSecret = String(options.defaultClientSecret || "").trim();
  const authPath = path.join(dataDir, "google-drive-auth.json");
  let pendingAuth = null;

  return {
    ensureDataDir,
    getStatus,
    beginConnect,
    finishConnect,
    listFolders,
    createFolder,
    uploadFile,
    disconnect
  };

  async function ensureDataDir() {
    await fsp.mkdir(dataDir, { recursive: true });
  }

  async function getStatus() {
    const auth = await loadAuth();
    return {
      ok: true,
      configured: !!(defaultClientId && defaultClientSecret),
      connected: !!(auth && auth.refreshToken && auth.clientId && auth.clientSecret),
      email: auth?.email || ""
    };
  }

  async function beginConnect(clientId, clientSecret, origin) {
    const resolvedClientId = String(clientId || defaultClientId || "").trim();
    const resolvedClientSecret = String(clientSecret || defaultClientSecret || "").trim();

    if (!resolvedClientId) {
      throw new Error("Google Drive OAuth is not configured on this machine. Set GOOGLE_CLIENT_ID in .env.local.");
    }
    if (!resolvedClientSecret) {
      throw new Error("Google Drive OAuth is not configured on this machine. Set GOOGLE_CLIENT_SECRET in .env.local.");
    }

    const redirectUri = new URL("/api/drive/callback", origin).toString();
    const codeVerifier = toBase64Url(crypto.randomBytes(32));
    const codeChallenge = toBase64Url(crypto.createHash("sha256").update(codeVerifier).digest());
    const state = crypto.randomUUID().replace(/-/g, "");

    pendingAuth = {
      clientId: resolvedClientId,
      clientSecret: resolvedClientSecret,
      codeVerifier,
      state,
      redirectUri,
      createdAt: Date.now()
    };

    const params = new URLSearchParams({
      response_type: "code",
      client_id: resolvedClientId,
      redirect_uri: redirectUri,
      scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      state
    });

    return {
      ok: true,
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    };
  }

  async function finishConnect({ code, state }) {
    if (!pendingAuth) {
      throw new Error("Google Drive sign-in session was not found. Start Connect again.");
    }

    if (Date.now() - pendingAuth.createdAt > 10 * 60 * 1000) {
      pendingAuth = null;
      throw new Error("Google Drive sign-in session expired. Start Connect again.");
    }

    if (!code) {
      throw new Error("Google Drive sign-in did not return an authorization code.");
    }

    if (state !== pendingAuth.state) {
      throw new Error("Google Drive sign-in returned an unexpected state value.");
    }

    const tokenResponse = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: pendingAuth.clientId,
        client_secret: pendingAuth.clientSecret,
        code,
        code_verifier: pendingAuth.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: pendingAuth.redirectUri
      })
    });

    const refreshToken = tokenResponse.refresh_token;
    if (!refreshToken) {
      pendingAuth = null;
      throw new Error("Google Drive did not return a refresh token. Remove this app from your Google account permissions and connect again.");
    }

    const accessToken = tokenResponse.access_token;
    const userInfo = accessToken
      ? await fetchJson("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` }
        }).catch(() => null)
      : null;

    await saveAuth({
      clientId: pendingAuth.clientId,
      clientSecret: pendingAuth.clientSecret,
      refreshToken,
      email: userInfo?.email || "",
      connectedAt: new Date().toISOString()
    });

    pendingAuth = null;
    return {
      ok: true,
      connected: true,
      email: userInfo?.email || ""
    };
  }

  async function listFolders() {
    const accessToken = await getAccessToken();
    const url = "https://www.googleapis.com/drive/v3/files?pageSize=100&fields=files(id,name,mimeType,trashed)&spaces=drive";
    const response = await fetchJson(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const folders = (response.files || [])
      .filter((item) => item && item.mimeType === "application/vnd.google-apps.folder" && !item.trashed)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((folder) => ({ id: String(folder.id), name: String(folder.name) }));

    return {
      ok: true,
      folders: [
        { id: "root", name: "My Drive (Root)" },
        ...folders
      ]
    };
  }

  async function createFolder(folderName) {
    if (!folderName || typeof folderName !== "string") {
      throw new Error("A folder name is required.");
    }

    const accessToken = await getAccessToken();
    const response = await fetchJson("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder"
      })
    });

    return {
      ok: true,
      id: String(response.id || ""),
      name: String(response.name || folderName)
    };
  }

  async function uploadFile({ filePath, folderId, deleteLocal = false }) {
    if (!filePath) {
      throw new Error("A local file path is required for Google Drive upload.");
    }

    const resolvedPath = path.resolve(filePath);
    await fsp.access(resolvedPath);

    if (!folderId) {
      throw new Error("A Google Drive folder must be selected before uploading.");
    }

    const accessToken = await getAccessToken();
    const fileName = path.basename(resolvedPath);
    const mimeType = getMimeType(resolvedPath);
    const stat = await fsp.stat(resolvedPath);
    const fileSize = stat.size;

    // Step 1: Initiate a resumable upload session
    const initResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink,parents",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(fileSize)
        },
        body: JSON.stringify({ name: fileName, parents: [folderId] })
      }
    );

    if (!initResponse.ok) {
      const errText = await initResponse.text();
      let errMsg;
      try { errMsg = JSON.parse(errText)?.error?.message; } catch {}
      throw new Error(errMsg || `Drive upload init failed: HTTP ${initResponse.status}`);
    }

    const uploadUrl = initResponse.headers.get("location");
    if (!uploadUrl) {
      throw new Error("Google Drive did not return an upload URL.");
    }

    // Step 2: Upload the file content using the resumable session URL
    const fileBuffer = await fsp.readFile(resolvedPath);
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(fileSize),
        "Content-Type": mimeType
      },
      body: fileBuffer
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      let errMsg;
      try { errMsg = JSON.parse(errText)?.error?.message; } catch {}
      throw new Error(errMsg || `Drive file upload failed: HTTP ${uploadResponse.status}`);
    }

    let response;
    try {
      response = JSON.parse(await uploadResponse.text());
    } catch {
      response = {};
    }

    if (deleteLocal) {
      await fsp.rm(resolvedPath, { force: true });
    }

    return {
      ok: true,
      id: String(response.id || ""),
      name: String(response.name || fileName),
      webViewLink: String(response.webViewLink || ""),
      webContentLink: String(response.webContentLink || ""),
      deletedLocal: !!deleteLocal
    };
  }

  async function disconnect() {
    await ensureDataDir();
    await fsp.rm(authPath, { force: true });
    pendingAuth = null;
    return { ok: true, connected: false };
  }

  async function loadAuth() {
    try {
      await ensureDataDir();
      const raw = await fsp.readFile(authPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function saveAuth(auth) {
    await ensureDataDir();
    await fsp.writeFile(authPath, JSON.stringify(auth, null, 2), "utf8");
  }

  async function getAccessToken() {
    const auth = await loadAuth();
    if (!auth?.clientId || !auth?.clientSecret || !auth?.refreshToken) {
      throw new Error("Google Drive is not connected yet.");
    }

    const tokenResponse = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        refresh_token: auth.refreshToken,
        grant_type: "refresh_token"
      })
    });

    if (!tokenResponse.access_token) {
      throw new Error("Google Drive access token request did not return an access token.");
    }

    return tokenResponse.access_token;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error_description || data?.error?.message || text || `Request failed with HTTP ${response.status}`);
  }

  return data || {};
}

function buildMultipartRelated(boundary, metadataJson, fileBuffer, mimeType) {
  const header = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf8"
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return Buffer.concat([header, fileBuffer, footer]);
}

function getMimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".mp4":
      return "video/mp4";
    case ".m4a":
      return "audio/mp4";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    default:
      return "application/octet-stream";
  }
}

function toBase64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

module.exports = {
  createGoogleDriveManager
};

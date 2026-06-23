const express = require("express");
const path = require("path");
const yaml = require("js-yaml");

const app = express();
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/convert/status", async (_req, res) => {
  try {
    const upstream = await fetchWithTimeout(`${getSubconverterUrl()}/version`);
    const version = (await upstream.text()).trim();

    res.status(upstream.ok ? 200 : 502).json({
      status: upstream.ok ? "running" : "error",
      backend: getSubconverterUrl(),
      version: version || null
    });
  } catch (error) {
    res.status(503).json({
      status: "offline",
      backend: getSubconverterUrl(),
      message: error.message
    });
  }
});

app.get("/api/convert", async (req, res) => {
  const sourceUrl = String(req.query.url || "").trim();
  const target = String(req.query.target || "clash").trim();

  if (!sourceUrl) {
    res.status(400).type("text/plain").send("Missing required query parameter: url");
    return;
  }

  try {
    const upstream = await fetchWithTimeout(buildSubconverterUrl(req.query));
    const body = await upstream.text();

    if (!upstream.ok) {
      res.status(upstream.status).type("text/plain").send(body);
      return;
    }

    const prefix = String(req.query.prefix || "").trim();
    const output =
      prefix && target === "clash" ? prefixClashYaml(body, prefix) : body;

    res
      .status(200)
      .set("content-type", upstream.headers.get("content-type") || inferContentType(target))
      .set("cache-control", "no-store")
      .send(output);
  } catch (error) {
    res.status(502).type("text/plain").send(`Conversion failed: ${error.message}`);
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`subconverter-oneclick listening on http://127.0.0.1:${port}`);
    console.log(`subconverter backend: ${getSubconverterUrl()}`);
  });
}

function getSubconverterUrl() {
  return normalizeBaseUrl(process.env.SUBCONVERTER_URL || "http://127.0.0.1:25500");
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function buildSubconverterUrl(query) {
  const params = new URLSearchParams();
  const passthrough = [
    "target",
    "url",
    "config",
    "emoji",
    "udp",
    "tfo",
    "scv",
    "fdn",
    "sort",
    "include",
    "exclude",
    "filename"
  ];

  for (const key of passthrough) {
    const value = query[key];
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }

  if (!params.has("target")) {
    params.set("target", "clash");
  }

  if (!params.has("emoji")) {
    params.set("emoji", "true");
  }

  return `${getSubconverterUrl()}/sub?${params.toString()}`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function inferContentType(target) {
  if (target === "clash" || target === "surfboard") {
    return "text/yaml; charset=utf-8";
  }

  if (target === "singbox") {
    return "application/json; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}

function prefixClashYaml(content, prefix) {
  const document = yaml.load(content);
  if (!document || !Array.isArray(document.proxies)) {
    return content;
  }

  const renameMap = new Map();

  document.proxies = document.proxies.map((proxy) => {
    if (!proxy || typeof proxy.name !== "string") {
      return proxy;
    }

    const nextName = proxy.name.startsWith(prefix)
      ? proxy.name
      : `${prefix}${proxy.name}`;

    renameMap.set(proxy.name, nextName);
    return {
      ...proxy,
      name: nextName
    };
  });

  if (Array.isArray(document["proxy-groups"])) {
    document["proxy-groups"] = document["proxy-groups"].map((group) => {
      if (!group || !Array.isArray(group.proxies)) {
        return group;
      }

      return {
        ...group,
        proxies: group.proxies.map((name) => renameMap.get(name) || name)
      };
    });
  }

  return yaml.dump(document, {
    lineWidth: -1,
    noRefs: true
  });
}

module.exports = {
  app,
  buildSubconverterUrl,
  getSubconverterUrl,
  prefixClashYaml
};

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

    const output =
      target === "clash" ? transformClashYaml(body, getClashTransformOptions(req.query)) : body;

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
  return transformClashYaml(content, { prefix });
}

function transformClashYaml(content, options = {}) {
  const document = yaml.load(content);
  if (!document || !Array.isArray(document.proxies)) {
    return content;
  }

  const prefix = String(options.prefix || "").trim();
  const renameMap = new Map();

  document.proxies = document.proxies.map((proxy) => {
    if (!proxy || typeof proxy.name !== "string") {
      return proxy;
    }

    const nextName = prefix && !proxy.name.startsWith(prefix)
      ? `${prefix}${proxy.name}`
      : proxy.name;

    renameMap.set(proxy.name, nextName);
    return {
      ...proxy,
      name: nextName
    };
  });

  if (Array.isArray(document["proxy-groups"])) {
    const allGroupNames = new Set(
      document["proxy-groups"]
        .map((group) => group?.name)
        .filter((name) => typeof name === "string")
    );
    const keptGroupNames = getKeptGroupNames(document["proxy-groups"], options);
    const shouldFilterGroups = keptGroupNames !== null;

    document["proxy-groups"] = document["proxy-groups"]
      .filter((group) => !shouldFilterGroups || keptGroupNames.has(group.name))
      .map((group) => {
        if (!group || !Array.isArray(group.proxies)) {
          return group;
        }

        return {
          ...group,
          proxies: group.proxies
            .filter((name) =>
              !shouldFilterGroups ||
              !isRemovedGroupReference(name, allGroupNames, keptGroupNames)
            )
            .map((name) => renameMap.get(name) || name)
        };
      });

    if (Array.isArray(document.rules) && shouldFilterGroups) {
      document.rules = document.rules.filter((rule) =>
        keepRuleForGroups(rule, allGroupNames, keptGroupNames)
      );
    }
  }

  return yaml.dump(document, {
    lineWidth: -1,
    noRefs: true
  });
}

function getClashTransformOptions(query) {
  return {
    prefix: String(query.prefix || "").trim(),
    groupPolicy: String(query.groupPolicy || "clean").trim(),
    groups: parseGroupList(query.groups)
  };
}

function getKeptGroupNames(groups, options) {
  if (options.groupPolicy === "all") {
    return null;
  }

  const requestedGroups = new Set(options.groups || []);

  if (!requestedGroups.size && options.groupPolicy !== "clean") {
    return null;
  }

  for (const group of groups) {
    if (DEFAULT_CLASH_GROUPS.has(normalizeGroupName(group?.name))) {
      requestedGroups.add(group.name);
    }
  }

  return requestedGroups;
}

function parseGroupList(value) {
  const values = Array.isArray(value) ? value : [value];

  return values
    .flatMap((item) => String(item || "").split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function isRemovedGroupReference(name, allGroupNames, keptGroupNames) {
  if (!allGroupNames.has(name) || keptGroupNames.has(name)) {
    return false;
  }

  if (DIRECT_PROXY_REFERENCES.has(name)) {
    return false;
  }

  return true;
}

function keepRuleForGroups(rule, allGroupNames, keptGroupNames) {
  if (typeof rule !== "string") {
    return true;
  }

  const policy = getRulePolicy(rule);

  if (
    !policy ||
    !allGroupNames.has(policy) ||
    DIRECT_PROXY_REFERENCES.has(policy) ||
    keptGroupNames.has(policy)
  ) {
    return true;
  }

  return false;
}

function getRulePolicy(rule) {
  const parts = rule.split(",").map((part) => part.trim()).filter(Boolean);

  while (parts.length) {
    const candidate = parts.pop();

    if (!RULE_OPTIONS.has(candidate)) {
      return candidate;
    }
  }

  return "";
}

function normalizeGroupName(name) {
  return String(name || "")
    .replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\s]+/u, "")
    .trim();
}

const DEFAULT_CLASH_GROUPS = new Set([
  "Proxy",
  "Auto",
  "Fallback",
  "Final",
  "DIRECT",
  "REJECT",
  "节点选择",
  "自动选择",
  "故障转移",
  "全球代理",
  "全球直连",
  "国外网站",
  "国内网站",
  "漏网之鱼"
]);

const DIRECT_PROXY_REFERENCES = new Set([
  "DIRECT",
  "REJECT",
  "REJECT-DROP",
  "PASS"
]);

const RULE_OPTIONS = new Set([
  "no-resolve",
  "resolve"
]);

module.exports = {
  app,
  buildSubconverterUrl,
  getSubconverterUrl,
  prefixClashYaml,
  transformClashYaml
};

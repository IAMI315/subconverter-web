const assert = require("assert");
const http = require("http");
const yaml = require("js-yaml");

const { app, transformClashYaml } = require("../server");

const upstream = http.createServer((req, res) => {
  if (req.url === "/version") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("subconverter mock 1.0");
    return;
  }

  if (req.url.startsWith("/sub?")) {
    const url = new URL(req.url, "http://127.0.0.1");
    assert.strictEqual(url.searchParams.get("target"), "clash");
    assert.strictEqual(url.searchParams.get("url"), "https://example.com/sub");

    res.writeHead(200, { "content-type": "text/yaml; charset=utf-8" });
    res.end(
      [
        "proxies:",
        "  - name: NodeA",
        "    type: ss",
        "proxy-groups:",
        "  - name: Proxy",
        "    proxies:",
        "      - NodeA",
        "  - name: Netflix",
        "    proxies:",
        "      - NodeA",
        "  - name: Microsoft",
        "    proxies:",
        "      - NodeA",
        "rules:",
        "  - DOMAIN-SUFFIX,netflix.com,Netflix",
        "  - DOMAIN-SUFFIX,microsoft.com,Microsoft",
        "  - MATCH,Proxy",
        ""
      ].join("\n")
    );
    return;
  }

  res.writeHead(404);
  res.end();
});

async function main() {
  assert.strictEqual(typeof transformClashYaml, "function");

  const filtered = yaml.load(
    transformClashYaml(
      [
        "proxies:",
        "  - name: NodeA",
        "    type: ss",
        "proxy-groups:",
        "  - name: Proxy",
        "    proxies:",
        "      - NodeA",
        "      - Netflix",
        "      - Microsoft",
        "  - name: Netflix",
        "    proxies:",
        "      - NodeA",
        "  - name: Microsoft",
        "    proxies:",
        "      - NodeA",
        "rules:",
        "  - DOMAIN-SUFFIX,netflix.com,Netflix",
        "  - DOMAIN-SUFFIX,microsoft.com,Microsoft",
        "  - DOMAIN,example.com,NodeA",
        "  - MATCH,Proxy",
        ""
      ].join("\n"),
      {
        prefix: "Test-",
        groupPolicy: "clean",
        groups: ["Proxy", "Netflix"]
      }
    )
  );

  assert.deepStrictEqual(
    filtered["proxy-groups"].map((group) => group.name),
    ["Proxy", "Netflix"]
  );
  assert.deepStrictEqual(filtered["proxy-groups"][0].proxies, [
    "Test-NodeA",
    "Netflix"
  ]);
  assert.match(filtered.rules.join("\n"), /netflix\.com,Netflix/);
  assert.doesNotMatch(filtered.rules.join("\n"), /microsoft\.com,Microsoft/);
  assert.match(filtered.rules.join("\n"), /example\.com,NodeA/);

  await listen(upstream, 0);
  process.env.SUBCONVERTER_URL = `http://127.0.0.1:${upstream.address().port}`;

  const server = await listen(http.createServer(app), 0);
  const appBaseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const home = await request(`${appBaseUrl}/`);
    assert.strictEqual(home.status, 200);
    assert.match(home.body, /订阅链接转换/);

    const health = await request(`${appBaseUrl}/health`);
    assert.strictEqual(health.status, 200);
    assert.match(health.body, /ok/);

    const status = await request(`${appBaseUrl}/api/convert/status`);
    assert.strictEqual(status.status, 200);
    assert.match(status.body, /subconverter mock 1\.0/);

    const convert = await request(
      `${appBaseUrl}/api/convert?target=clash&url=https%3A%2F%2Fexample.com%2Fsub&prefix=Test-`
    );
    assert.strictEqual(convert.status, 200);
    assert.match(convert.body, /name: Test-NodeA/);
    assert.match(convert.body, /- Test-NodeA/);

    const customGroups = await request(
      `${appBaseUrl}/api/convert?target=clash&url=https%3A%2F%2Fexample.com%2Fsub&groups=Proxy%2CNetflix`
    );
    assert.strictEqual(customGroups.status, 200);
    assert.match(customGroups.body, /name: Proxy/);
    assert.match(customGroups.body, /name: Netflix/);
    assert.doesNotMatch(customGroups.body, /name: Microsoft/);
    assert.doesNotMatch(customGroups.body, /microsoft\.com,Microsoft/);

    const missing = await request(`${appBaseUrl}/api/convert`);
    assert.strictEqual(missing.status, 400);

    console.log("smoke tests passed");
  } finally {
    await close(server);
    await close(upstream);
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function request(url) {
  const response = await fetch(url, {
    headers: {
      connection: "close"
    }
  });

  return {
    status: response.status,
    body: await response.text()
  };
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });

// Real Engine calls; only the cloud proxy and its trusted CA are injected into runtimes.
// This entry point is never included in the production image.
import { createApp } from "../../apps/api/src/app.ts";
import {
  Engine,
  type CreateContainer,
} from "../../packages/docker/src/index.ts";
const proxy = new URL(process.env.HTTPS_PROXY!),
  trustedHost = process.env.MINEMATE_TEST_TRUST_HOST!;
class CloudTestEngine extends Engine {
  override async create(name: string, spec: CreateContainer) {
    if (spec.Labels["io.minemate.kind"] === "minecraft-server") {
      spec.HostConfig.Binds = [
        ...(spec.HostConfig.Binds ?? []),
        `${trustedHost}:/trusted-ca:ro`,
      ];
      spec.Env = [
        ...(spec.Env ?? []),
        `PROXY_HOST=${proxy.hostname}`,
        `PROXY_PORT=${proxy.port}`,
        `HTTP_PROXY=${proxy.href}`,
        `HTTPS_PROXY=${proxy.href}`,
        `http_proxy=${proxy.href}`,
        `https_proxy=${proxy.href}`,
        "NO_PROXY=localhost,127.0.0.1",
        "CURL_CA_BUNDLE=/trusted-ca/ca.pem",
        "SSL_CERT_FILE=/trusted-ca/ca.pem",
        `JAVA_TOOL_OPTIONS=-Dhttp.proxyHost=${proxy.hostname} -Dhttp.proxyPort=${proxy.port} -Dhttps.proxyHost=${proxy.hostname} -Dhttps.proxyPort=${proxy.port} -Dhttp.nonProxyHosts=localhost|127.* -Djavax.net.ssl.trustStore=/trusted-ca/cacerts -Djavax.net.ssl.trustStorePassword=changeit`,
      ];
    }
    return super.create(name, spec);
  }
}
const instance = await createApp({
  docker: new CloudTestEngine(process.env.MINEMATE_DOCKER_ENDPOINT!),
});
await instance.app.listen({ host: "0.0.0.0", port: 8080 });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void instance.app.close().then(() => process.exit(0));
  });

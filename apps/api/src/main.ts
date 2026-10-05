import { createApp, listen } from "./app.ts";
const instance = await createApp();
await listen(instance.app, instance.config);
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void instance.app
      .close()
      .then(() => process.exit(0))
      .catch((e) => {
        instance.app.log.error(e);
        process.exit(1);
      });
  });

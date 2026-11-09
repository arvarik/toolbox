import "dotenv/config";
import { DB_PATH, DEFAULT_PORT } from "./appConfig.ts";
import { validateSecretKey } from "./platform/crypto/secretBox.ts";
import { validatePublicUrl } from "./platform/net/originAndFetch.ts";
import { createApp } from "./app.ts";
import logger from "./utils/logger.ts";

validateSecretKey();
validatePublicUrl();

const app = createApp();
const PORT = Number(process.env.PORT || DEFAULT_PORT);
const isProduction = process.env.NODE_ENV === "production";

app.listen(PORT, "0.0.0.0", () => {
  logger.info(
    `Toolbox v2 server running at http://localhost:${PORT} (${isProduction ? "production" : "development"}, db=${DB_PATH})`,
  );
});

import app from "./app";
import { logger } from "./lib/logger";
import { initializeSemanticSearch, startEmbeddingWorker } from "./lib/semantic-search";
import { initializeConnections } from "./lib/connections";
import { startConnectionWorker } from "./lib/connections-discovery";
import { initializeSpaces } from "./lib/spaces";
import { startSpacesWorker } from "./lib/spaces-discovery";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await initializeSemanticSearch();
await initializeConnections();
await initializeSpaces();
startEmbeddingWorker();
startConnectionWorker();
startSpacesWorker();
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

import { sqlite } from "./platform/db/connection.ts";
import { initKitsSchema } from "./kits/kitsSchema.ts";

initKitsSchema(sqlite);

export { sqlite };
export default sqlite;

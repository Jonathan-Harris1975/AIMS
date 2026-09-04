import routes from "./routes/index.js";
import { mountServiceRoutes } from "../shared/utils/serviceRouter.js";

export const commsHubRouter = mountServiceRoutes(routes);
export default commsHubRouter;

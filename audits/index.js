import routes from "./routes/index.js";
import { mountServiceRoutes } from "../services/shared/utils/serviceRouter.js";

export const auditRouter = mountServiceRoutes(routes);
export default auditRouter;

import routes from "./routes/index.js";
import { mountServiceRoutes } from "../shared/utils/serviceRouter.js";

export const blotatoRouter = mountServiceRoutes(routes);
export default blotatoRouter;

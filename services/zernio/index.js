import routes from "./routes/index.js";
import { mountServiceRoutes } from "../shared/utils/serviceRouter.js";

export const zernioRouter = mountServiceRoutes(routes);
export default zernioRouter;

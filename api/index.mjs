import { app } from '../server/app.mjs';

// Export the handler without listening or opening a local database on Vercel.
export default app;

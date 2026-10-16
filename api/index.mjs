// Load inside the request so startup failures produce JSON rather than Vercel's
// opaque FUNCTION_INVOCATION_FAILED response. Share initialization across requests.
let application;
export default async function handler(req, res) {
  try {
    application ??= import('../server/app.mjs').then(module => module.app);
    const app = await application;
    return app(req, res);
  } catch (error) {
    console.error('Gather API startup failed:', error);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 503;
    res.end(JSON.stringify({
      error: error.code === 'GATHER_CONFIGURATION_ERROR'
        ? error.message
        : 'Gather API could not start. Check this request in Vercel Runtime Logs for the startup error.',
      code: error.code === 'GATHER_CONFIGURATION_ERROR' ? error.code : 'GATHER_STARTUP_FAILED',
    }));
  }
}

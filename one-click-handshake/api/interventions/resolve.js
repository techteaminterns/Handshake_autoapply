/**
 * POST /api/interventions/resolve
 *
 * Convenience alias for /api/interventions/:id/resolve accepting id in query or body.
 */

import handler from './[id]/resolve.js';

export default handler;

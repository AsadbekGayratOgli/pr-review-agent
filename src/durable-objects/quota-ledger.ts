export class QuotaLedger implements DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {}

  fetch(request: Request): Response {
    return new Response('Not implemented', { status: 501 });
  }
}

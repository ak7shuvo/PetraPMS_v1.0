// Single entry point for the JSON API. See src/server/api.ts for the router.
import { dispatch, type Method } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

const handler = (method: Method) => async (req: Request, { params }: Params) => dispatch(req, method, (await params).path ?? []);

export const GET = handler("GET");
export const POST = handler("POST");
export const PUT = handler("PUT");
export const PATCH = handler("PATCH");
export const DELETE = handler("DELETE");

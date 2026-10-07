// OpenAPI 3.1 description of the POS integration API (served at /api/pos/v1/openapi.json).
const money = { type: "integer", description: "Amount in poisha (1 taka = 100 poisha)", example: 125000 };
const error = { type: "object", properties: { ok: { const: false }, error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } };
const ok = (data: unknown) => ({ type: "object", properties: { ok: { const: true }, data } });

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "PetraPMS POS Integration API",
    version: "1.0.0",
    description:
      "Post restaurant / bar / spa checks to in-house guest folios. Authenticate with an API key created in Settings → POS integration (header `X-API-Key`). " +
      "Charges are idempotent per `outlet` + `checkNumber`: retrying the same check returns the original posting with `duplicate: true`. " +
      "Amounts are integers in poisha. Taxes (service charge, VAT) are applied by PetraPMS according to the charge code; send `taxInclusive: true` if your amount already includes them.",
  },
  servers: [{ url: "/api", description: "This PetraPMS server (e.g. http://192.168.1.10:3000/api)" }],
  components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-API-Key" } }, schemas: { Error: error } },
  security: [{ apiKey: [] }],
  paths: {
    "/pos/v1/ping": { get: { summary: "Check connectivity and key", responses: { "200": { description: "OK", content: { "application/json": { schema: ok({ type: "object", properties: { hotel: { type: "string" }, businessDate: { type: "string", format: "date" }, version: { type: "string" } } }) } } }, "401": { description: "Missing / invalid key" } } } },
    "/pos/v1/rooms": { get: { summary: "List in-house rooms that can be charged", responses: { "200": { description: "OK", content: { "application/json": { schema: ok({ type: "array", items: { type: "object", properties: { roomNumber: { type: "string" }, guestName: { type: "string" }, lastName: { type: "string" }, departureDate: { type: "string" }, allowCharges: { type: "boolean" } } } }) } } } } } },
    "/pos/v1/rooms/{number}": { get: { summary: "Look up one room", parameters: [{ name: "number", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "ROOM_NOT_IN_HOUSE" } } } },
    "/pos/v1/charges": {
      post: {
        summary: "Post a check to a room",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["roomNumber", "checkNumber", "amount"],
                properties: {
                  roomNumber: { type: "string", example: "204" },
                  guestName: { type: "string", description: "Optional last/full name verification" },
                  outlet: { type: "string", default: "RESTAURANT" },
                  checkNumber: { type: "string", example: "R-10234" },
                  chargeCode: { type: "string", default: "REST", description: "PetraPMS charge code (REST, MINI, LNDRY, ...)" },
                  amount: money,
                  taxInclusive: { type: "boolean", default: false },
                  description: { type: "string" },
                  covers: { type: "integer" },
                  items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "number" }, amount: money } } },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Posted (or duplicate)", content: { "application/json": { schema: ok({ type: "object", properties: { duplicate: { type: "boolean" }, chargeId: { type: "string" }, folio: { type: "string" }, net: money, serviceCharge: money, vat: money, total: money } }) } } },
          "403": { description: "CHARGES_BLOCKED" },
          "404": { description: "ROOM_NOT_IN_HOUSE" },
          "409": { description: "NAME_MISMATCH" },
          "423": { description: "License read-only" },
        },
      },
    },
    "/pos/v1/charges/void": { post: { summary: "Void a check posted today", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["checkNumber", "reason"], properties: { outlet: { type: "string" }, checkNumber: { type: "string" }, reason: { type: "string" } } } } } }, responses: { "200": { description: "Voided" }, "409": { description: "PAST_DATE" } } } },
  },
} as const;

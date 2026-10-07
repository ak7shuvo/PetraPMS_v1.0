// Permission catalogue and the default role matrix. The matrix is seeded into the database and is editable in
// Settings → Roles; the server always checks permissions from the database, never from this file.

export interface PermissionDef {
  code: string;
  module: string;
  label: string;
  /** sensitive actions are always audit-logged with before/after values */
  sensitive?: boolean;
}

const P = (module: string, entries: [string, string, boolean?][]): PermissionDef[] => entries.map(([action, label, sensitive]) => ({ code: `${module}.${action}`, module, label, sensitive: !!sensitive }));

export const PERMISSIONS: PermissionDef[] = [
  ...P("dashboard", [
    ["view", "View dashboard"],
    ["financials", "See revenue figures on dashboard"],
  ]),
  ...P("rooms", [
    ["view", "View rooms, room rack and tape chart"],
    ["manage", "Create/edit room types and rooms", true],
    ["block", "Block rooms / set out of order", true],
    ["move", "Move guests between rooms"],
  ]),
  ...P("rates", [
    ["view", "View rate plans and seasons"],
    ["manage", "Edit rate plans, seasons and extras", true],
    ["override", "Override nightly rate on a booking", true],
    ["discount", "Apply discounts up to own limit"],
    ["discount_approve", "Approve discounts above limit", true],
  ]),
  ...P("reservations", [
    ["view", "View reservations"],
    ["create", "Create reservations"],
    ["edit", "Edit reservations"],
    ["cancel", "Cancel reservations / mark no-show", true],
    ["waive_penalty", "Waive cancellation penalty", true],
  ]),
  ...P("frontdesk", [
    ["checkin", "Check in guests"],
    ["checkout", "Check out guests"],
    ["checkout_balance", "Check out with an open balance (city ledger)", true],
    ["handover", "Write shift handover notes"],
    ["police_export", "Export foreign guest (police) report", true],
  ]),
  ...P("guests", [
    ["view", "View guest profiles"],
    ["edit", "Create/edit guest profiles"],
    ["blacklist", "Blacklist / un-blacklist guests", true],
    ["merge", "Merge duplicate guest profiles", true],
    ["companies", "Manage companies and corporate rates"],
  ]),
  ...P("folio", [
    ["view", "View folios"],
    ["charge", "Post charges"],
    ["payment", "Take payments"],
    ["refund", "Issue refunds", true],
    ["adjust", "Post adjustments / allowances", true],
    ["void", "Void charges and payments", true],
    ["transfer", "Transfer charges between folios"],
    ["invoice", "Issue invoices"],
    ["reopen", "Reopen settled folios", true],
  ]),
  ...P("ledger", [
    ["view", "View city ledger and aging"],
    ["manage", "Post city ledger payments", true],
  ]),
  ...P("housekeeping", [
    ["view", "View housekeeping board"],
    ["update", "Update room cleaning status (own tasks)"],
    ["assign", "Assign tasks and inspect rooms"],
    ["lostfound", "Manage lost & found"],
    ["linen", "Manage linen and minibar"],
  ]),
  ...P("maintenance", [
    ["view", "View maintenance tickets"],
    ["create", "Raise tickets"],
    ["manage", "Assign, resolve and schedule maintenance"],
  ]),
  ...P("nightaudit", [
    ["run", "Run night audit", true],
    ["rollback", "Roll back business date (Super Admin)", true],
  ]),
  ...P("reports", [
    ["view", "View operational reports"],
    ["financial", "View financial reports"],
    ["export", "Export reports"],
    ["schedule", "Schedule report exports"],
  ]),
  ...P("pos", [
    ["view", "View POS integration log"],
    ["manage", "Manage POS API keys", true],
  ]),
  ...P("users", [
    ["view", "View users"],
    ["manage", "Create/edit users and reset passwords", true],
    ["roles", "Edit role permissions", true],
  ]),
  ...P("settings", [
    ["view", "View settings"],
    ["manage", "Change hotel settings, taxes and payment methods", true],
    ["branding", "Change white-label branding", true],
  ]),
  ...P("data", [
    ["import", "Use the Data Import Center", true],
    ["export", "Export data", true],
    ["demo", "Load / clear demo data", true],
    ["backup", "Create and download backups", true],
    ["restore", "Restore a backup", true],
  ]),
  ...P("audit", [["view", "View audit log"]]),
  ...P("license", [["manage", "Activate and transfer license", true]]),
];

export const PERMISSION_CODES = PERMISSIONS.map((p) => p.code);
export const SENSITIVE = new Set(PERMISSIONS.filter((p) => p.sensitive).map((p) => p.code));

export interface RoleDef {
  code: string;
  name: string;
  nameBn: string;
  permissions: string[];
}

const all = (prefix: string) => PERMISSION_CODES.filter((c) => c.startsWith(prefix + "."));
const except = (codes: string[], ...remove: string[]) => codes.filter((c) => !remove.includes(c));

export const DEFAULT_ROLES: RoleDef[] = [
  { code: "SUPER_ADMIN", name: "Super Admin", nameBn: "সুপার অ্যাডমিন", permissions: [...PERMISSION_CODES] },
  { code: "GM", name: "General Manager", nameBn: "জেনারেল ম্যানেজার", permissions: except(PERMISSION_CODES, "nightaudit.rollback", "license.manage", "data.restore") },
  {
    code: "FO_MANAGER",
    name: "Front Desk Manager",
    nameBn: "ফ্রন্ট ডেস্ক ম্যানেজার",
    permissions: [
      ...all("dashboard"),
      ...all("rooms"),
      "rates.view",
      "rates.override",
      "rates.discount",
      "rates.discount_approve",
      ...all("reservations"),
      ...all("frontdesk"),
      ...all("guests"),
      ...except(all("folio"), "folio.reopen"),
      "ledger.view",
      "housekeeping.view",
      "housekeeping.assign",
      "housekeeping.lostfound",
      "maintenance.view",
      "maintenance.create",
      "nightaudit.run",
      "reports.view",
      "reports.financial",
      "reports.export",
      "users.view",
      "settings.view",
      "audit.view",
    ],
  },
  {
    code: "RECEPTIONIST",
    name: "Receptionist",
    nameBn: "রিসেপশনিস্ট",
    permissions: [
      "dashboard.view",
      "rooms.view",
      "rooms.move",
      "rates.view",
      "rates.discount",
      "reservations.view",
      "reservations.create",
      "reservations.edit",
      "reservations.cancel",
      "frontdesk.checkin",
      "frontdesk.checkout",
      "frontdesk.handover",
      "guests.view",
      "guests.edit",
      "folio.view",
      "folio.charge",
      "folio.payment",
      "folio.transfer",
      "folio.invoice",
      "housekeeping.view",
      "housekeeping.lostfound",
      "maintenance.view",
      "maintenance.create",
      "nightaudit.run",
      "reports.view",
    ],
  },
  {
    code: "HK_SUPERVISOR",
    name: "Housekeeping Supervisor",
    nameBn: "হাউসকিপিং সুপারভাইজার",
    permissions: ["dashboard.view", "rooms.view", "rooms.block", ...all("housekeeping"), "maintenance.view", "maintenance.create", "reports.view", "folio.charge"],
  },
  { code: "HOUSEKEEPER", name: "Housekeeper", nameBn: "হাউসকিপার", permissions: ["housekeeping.view", "housekeeping.update", "housekeeping.lostfound", "maintenance.create"] },
  {
    code: "ACCOUNTANT",
    name: "Accountant",
    nameBn: "হিসাবরক্ষক",
    permissions: ["dashboard.view", "dashboard.financials", "rooms.view", "rates.view", "reservations.view", "guests.view", "guests.companies", ...all("folio"), ...all("ledger"), ...all("reports"), "pos.view", "settings.view", "data.export", "audit.view"],
  },
  { code: "MAINTENANCE", name: "Maintenance", nameBn: "রক্ষণাবেক্ষণ", permissions: ["rooms.view", ...all("maintenance"), "housekeeping.view"] },
  { code: "CASHIER", name: "Restaurant Cashier", nameBn: "রেস্টুরেন্ট ক্যাশিয়ার", permissions: ["rooms.view", "guests.view", "folio.view", "folio.charge", "pos.view"] },
];

/** Landing page for a role's users (first module they can see). */
export function homeFor(perms: Set<string> | string[]): string {
  const s = perms instanceof Set ? perms : new Set(perms);
  const order: [string, string][] = [
    ["dashboard.view", "/dashboard"],
    ["housekeeping.view", "/housekeeping"],
    ["maintenance.view", "/maintenance"],
    ["folio.view", "/folios"],
    ["reports.view", "/reports"],
  ];
  return order.find(([p]) => s.has(p))?.[1] ?? "/profile";
}

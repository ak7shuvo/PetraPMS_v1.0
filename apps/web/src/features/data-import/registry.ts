// Data Import Center — entity registry (shared by the browser wizard and the server engine).
// Each entity lists its columns with type, validation and header aliases (English + Bangla) so files exported
// from other systems map automatically. The same definitions drive CSV/XLSX templates in /public/templates and
// round-trip exports, so an exported file can always be re-imported.

export type FieldType = "text" | "code" | "int" | "money" | "percent" | "bool" | "date" | "time" | "enum" | "phone" | "email" | "list";

export interface FieldDef {
  key: string;
  label: string;
  labelBn: string;
  type: FieldType;
  required?: boolean;
  enum?: readonly string[];
  max?: number;
  min?: number;
  aliases?: string[];
  example: string;
  help?: string;
}

export interface EntityDef {
  id: string;
  label: string;
  labelBn: string;
  description: string;
  /** field used to find existing records for UPDATE / UPSERT */
  keyField: string;
  /** import order hint for the Quick Setup checklist (lower first) */
  order: number;
  fields: FieldDef[];
  /** entities whose codes this one references */
  dependsOn?: string[];
  /** CREATE only (e.g. reservations: no update by file) */
  createOnly?: boolean;
}

const f = (key: string, label: string, labelBn: string, type: FieldType, example: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, labelBn, type, example, ...extra });

export const BED_TYPES = ["SINGLE", "DOUBLE", "TWIN", "QUEEN", "KING", "TRIPLE"] as const;
export const SOURCES = ["WALK_IN", "PHONE", "WEBSITE", "OTA", "CORPORATE", "AGENT", "EMAIL"] as const;

export const ENTITIES: EntityDef[] = [
  {
    id: "roomTypes",
    label: "Room types",
    labelBn: "রুম টাইপ",
    description: "Categories of rooms with occupancy and base nightly rate.",
    keyField: "code",
    order: 1,
    fields: [
      f("code", "Code", "কোড", "code", "DLX", { required: true, max: 20, aliases: ["type code", "room type code", "short code"] }),
      f("name", "Name", "নাম", "text", "Deluxe", { required: true, max: 120, aliases: ["room type", "type name", "description"] }),
      f("nameBn", "Name (Bangla)", "নাম (বাংলা)", "text", "ডিলাক্স", { max: 120 }),
      f("bedType", "Bed type", "বেডের ধরন", "enum", "QUEEN", { enum: BED_TYPES, aliases: ["bed"] }),
      f("baseOccupancy", "Base occupancy", "সাধারণ অতিথি", "int", "2", { min: 1, max: 10, aliases: ["base pax", "standard occupancy"] }),
      f("maxAdults", "Max adults", "সর্বোচ্চ প্রাপ্তবয়স্ক", "int", "3", { min: 1, max: 10 }),
      f("maxChildren", "Max children", "সর্বোচ্চ শিশু", "int", "2", { min: 0, max: 10 }),
      f("maxOccupancy", "Max occupancy", "সর্বোচ্চ অতিথি", "int", "4", { min: 1, max: 12, aliases: ["max pax"] }),
      f("baseRate", "Base rate", "মূল ভাড়া", "money", "6500.00", { required: true, aliases: ["rate", "rack rate", "price", "tariff", "ভাড়া"] }),
      f("extraAdultRate", "Extra adult rate", "অতিরিক্ত প্রাপ্তবয়স্ক", "money", "1200.00"),
      f("extraChildRate", "Extra child rate", "অতিরিক্ত শিশু", "money", "600.00"),
      f("extraBedRate", "Extra bed rate", "অতিরিক্ত বেড", "money", "1000.00"),
      f("amenities", "Amenities (codes, ; separated)", "সুবিধা", "list", "AC;WIFI;TV"),
      f("description", "Description", "বিবরণ", "text", "Queen bed, city view", { max: 1000 }),
      f("active", "Active", "সক্রিয়", "bool", "yes"),
    ],
  },
  {
    id: "rooms",
    label: "Rooms",
    labelBn: "রুম",
    description: "Physical rooms with floor and room type.",
    keyField: "number",
    order: 2,
    dependsOn: ["roomTypes"],
    fields: [
      f("number", "Room number", "রুম নম্বর", "code", "201", { required: true, max: 10, aliases: ["room", "room no", "room #", "রুম"] }),
      f("floor", "Floor", "তলা", "text", "2", { required: true, max: 10, aliases: ["level"] }),
      f("roomTypeCode", "Room type code", "রুম টাইপ কোড", "code", "DLX", { required: true, aliases: ["type", "room type", "category"] }),
      f("features", "Features", "বৈশিষ্ট্য", "text", "Balcony; city view", { max: 200 }),
      f("notes", "Notes", "নোট", "text", "", { max: 500 }),
      f("hkStatus", "Housekeeping status", "পরিষ্কার অবস্থা", "enum", "CLEAN", { enum: ["CLEAN", "DIRTY", "IN_PROGRESS", "INSPECTED"] }),
      f("active", "Active", "সক্রিয়", "bool", "yes"),
    ],
  },
  {
    id: "ratePlans",
    label: "Rate plans",
    labelBn: "রেট প্ল্যান",
    description: "Rate plans with meal plan and adjustment over the room type base rate.",
    keyField: "code",
    order: 3,
    fields: [
      f("code", "Code", "কোড", "code", "BB", { required: true }),
      f("name", "Name", "নাম", "text", "Bed & Breakfast", { required: true, max: 120 }),
      f("type", "Type", "ধরন", "enum", "PACKAGE", { enum: ["RACK", "CORPORATE", "WEEKEND", "SEASONAL", "PACKAGE", "WALKIN", "OTA"] }),
      f("mealPlan", "Meal plan", "খাবারের প্ল্যান", "enum", "BB", { enum: ["RO", "BB", "HB", "FB"] }),
      f("mealPricePerAdult", "Meal price per adult", "প্রাপ্তবয়স্ক খাবার মূল্য", "money", "450.00"),
      f("mealPricePerChild", "Meal price per child", "শিশু খাবার মূল্য", "money", "250.00"),
      f("adjustmentType", "Adjustment type", "সমন্বয়ের ধরন", "enum", "PERCENT", { enum: ["NONE", "PERCENT", "AMOUNT"] }),
      f("adjustmentValue", "Adjustment (% or amount, may be negative)", "সমন্বয়", "text", "-10", { help: "PERCENT: -10 means 10% off; AMOUNT: -500.00 means 500 taka off" }),
      f("weekendAdjustment", "Weekend adjustment %", "সাপ্তাহিক ছুটির সমন্বয় %", "text", "10"),
      f("minStay", "Minimum stay (nights)", "সর্বনিম্ন রাত", "int", "1", { min: 1, max: 365 }),
      f("cancellationPolicyCode", "Cancellation policy code", "বাতিল নীতি কোড", "code", "FLEX24"),
      f("active", "Active", "সক্রিয়", "bool", "yes"),
    ],
  },
  {
    id: "rateSeasons",
    label: "Seasonal / event rates",
    labelBn: "মৌসুমি রেট",
    description: "Date ranges that raise or lower rates (Eid, winter season, events).",
    keyField: "name",
    order: 4,
    dependsOn: ["ratePlans", "roomTypes"],
    fields: [
      f("name", "Name", "নাম", "text", "Eid-ul-Adha", { required: true, max: 120 }),
      f("startDate", "Start date", "শুরু", "date", "2026-06-15", { required: true }),
      f("endDate", "End date (inclusive)", "শেষ", "date", "2026-06-20", { required: true }),
      f("adjustmentType", "Adjustment type", "সমন্বয়ের ধরন", "enum", "PERCENT", { enum: ["PERCENT", "AMOUNT", "FIXED"], required: true }),
      f("value", "Value (% / amount / fixed rate)", "মান", "text", "25", { required: true }),
      f("ratePlanCode", "Rate plan code (blank = all)", "রেট প্ল্যান কোড", "code", ""),
      f("roomTypeCode", "Room type code (blank = all)", "রুম টাইপ কোড", "code", ""),
      f("daysOfWeek", "Days (0=Sun … 6=Sat, ; separated; blank = all)", "দিন", "list", ""),
      f("minStay", "Minimum stay", "সর্বনিম্ন রাত", "int", "0", { min: 0, max: 60 }),
      f("priority", "Priority", "অগ্রাধিকার", "int", "0", { min: 0, max: 100 }),
    ],
  },
  {
    id: "companies",
    label: "Companies (corporate accounts)",
    labelBn: "প্রতিষ্ঠান",
    description: "Corporate clients with credit terms for the city ledger.",
    keyField: "code",
    order: 5,
    fields: [
      f("code", "Code", "কোড", "code", "GTL", { required: true, aliases: ["company code", "account"] }),
      f("name", "Name", "নাম", "text", "Grameen Textiles Ltd.", { required: true, max: 120, aliases: ["company", "company name", "organization"] }),
      f("contactPerson", "Contact person", "যোগাযোগকারী", "text", "Mr. Habib", { max: 80 }),
      f("phone", "Phone", "ফোন", "phone", "01711000000"),
      f("email", "Email", "ইমেইল", "email", "accounts@gtl.com.bd"),
      f("address", "Address", "ঠিকানা", "text", "Gulshan 1, Dhaka", { max: 300 }),
      f("bin", "BIN", "বিআইএন", "text", "000123456789", { max: 30, aliases: ["vat reg", "vat registration"] }),
      f("creditLimit", "Credit limit", "ক্রেডিট সীমা", "money", "300000.00"),
      f("paymentTermsDays", "Payment terms (days)", "পরিশোধের মেয়াদ", "int", "30", { min: 0, max: 365 }),
      f("discount", "Discount %", "ছাড় %", "text", "10"),
      f("ratePlanCode", "Rate plan code", "রেট প্ল্যান", "code", "CORP"),
      f("active", "Active", "সক্রিয়", "bool", "yes"),
    ],
  },
  {
    id: "guests",
    label: "Guests",
    labelBn: "অতিথি",
    description: "Guest profiles (CRM). Matched by phone on update.",
    keyField: "phone",
    order: 6,
    dependsOn: ["companies"],
    fields: [
      f("title", "Title", "পদবি", "text", "Mr", { max: 10 }),
      f("firstName", "First name", "নামের প্রথম অংশ", "text", "Rahim", { required: true, max: 80, aliases: ["first", "given name", "name"] }),
      f("lastName", "Last name", "নামের শেষ অংশ", "text", "Uddin", { max: 80, aliases: ["surname", "family name"] }),
      f("phone", "Phone", "ফোন", "phone", "01711223344", { aliases: ["mobile", "cell", "contact", "মোবাইল"] }),
      f("email", "Email", "ইমেইল", "email", "rahim@example.com"),
      f("gender", "Gender (M/F/O)", "লিঙ্গ", "enum", "M", { enum: ["", "M", "F", "O"] }),
      f("dateOfBirth", "Date of birth", "জন্ম তারিখ", "date", "1985-04-12", { aliases: ["dob", "birth date"] }),
      f("nationality", "Nationality (2-letter)", "জাতীয়তা", "code", "BD", { max: 2 }),
      f("idType", "ID type", "পরিচয়পত্রের ধরন", "enum", "NID", { enum: ["", "NID", "PASSPORT", "DRIVING_LICENSE", "BIRTH_CERT", "OTHER"] }),
      f("idNumber", "ID number", "পরিচয়পত্র নম্বর", "text", "1990123456789", { max: 40, aliases: ["nid", "national id"] }),
      f("passportNumber", "Passport no", "পাসপোর্ট নম্বর", "text", "", { max: 30 }),
      f("passportExpiry", "Passport expiry", "পাসপোর্টের মেয়াদ", "date", ""),
      f("visaNumber", "Visa no", "ভিসা নম্বর", "text", "", { max: 40 }),
      f("visaExpiry", "Visa expiry", "ভিসার মেয়াদ", "date", ""),
      f("address", "Address", "ঠিকানা", "text", "House 12, Road 5, Dhanmondi", { max: 300 }),
      f("city", "City", "শহর", "text", "Dhaka", { max: 80 }),
      f("country", "Country (2-letter)", "দেশ", "code", "BD", { max: 2 }),
      f("occupation", "Occupation", "পেশা", "text", "Engineer", { max: 80 }),
      f("companyCode", "Company code", "প্রতিষ্ঠান কোড", "code", ""),
      f("vip", "VIP level (0-3)", "ভিআইপি", "int", "0", { min: 0, max: 3 }),
      f("preferences", "Preferences", "পছন্দ", "text", "High floor", { max: 1000 }),
      f("notes", "Notes", "নোট", "text", "", { max: 2000 }),
      f("marketingOptIn", "Marketing opt-in", "প্রচারণা সম্মতি", "bool", "no"),
    ],
  },
  {
    id: "chargeCodes",
    label: "Charge codes / extras",
    labelBn: "চার্জ কোড",
    description: "Items you post to folios (laundry, minibar, transport…).",
    keyField: "code",
    order: 7,
    fields: [
      f("code", "Code", "কোড", "code", "SPA", { required: true }),
      f("name", "Name", "নাম", "text", "Spa treatment", { required: true, max: 120 }),
      f("nameBn", "Name (Bangla)", "নাম (বাংলা)", "text", "স্পা", { max: 120 }),
      f("category", "Category", "খাত", "enum", "MISC", { enum: ["ROOM", "EXTRA_BED", "FNB", "LAUNDRY", "MINIBAR", "TRANSPORT", "TOUR", "MISC"], required: true }),
      f("defaultAmount", "Default amount", "ডিফল্ট মূল্য", "money", "2500.00"),
      f("taxable", "Taxable", "করযোগ্য", "bool", "yes"),
      f("active", "Active", "সক্রিয়", "bool", "yes"),
    ],
  },
  {
    id: "users",
    label: "Staff user accounts",
    labelBn: "ব্যবহারকারী",
    description: "Login accounts. New users get a temporary password shown once in the import result.",
    keyField: "username",
    order: 8,
    fields: [
      f("username", "Username", "ইউজারনেম", "code", "rahima.fd", { required: true, max: 40 }),
      f("fullName", "Full name", "পূর্ণ নাম", "text", "Rahima Akter", { required: true, max: 120 }),
      f("roleCode", "Role code", "ভূমিকা", "code", "RECEPTIONIST", { required: true, help: "SUPER_ADMIN, GM, FO_MANAGER, RECEPTIONIST, HK_SUPERVISOR, HOUSEKEEPER, ACCOUNTANT, MAINTENANCE, CASHIER or a custom role code" }),
      f("phone", "Phone", "ফোন", "phone", "01811000000"),
      f("email", "Email", "ইমেইল", "email", ""),
      f("locale", "Language (en/bn)", "ভাষা", "enum", "bn", { enum: ["en", "bn"] }),
      f("active", "Active", "সক্রিয়", "bool", "yes"),
    ],
  },
  {
    id: "reservations",
    label: "Future reservations",
    labelBn: "ভবিষ্যৎ বুকিং",
    description: "Bookings taken in your old system. Availability is checked; no overbooking.",
    keyField: "externalRef",
    order: 9,
    createOnly: true,
    dependsOn: ["roomTypes", "rooms", "ratePlans", "companies"],
    fields: [
      f("externalRef", "Old system booking no", "পুরনো বুকিং নম্বর", "text", "OLD-1043", { required: true, max: 60, aliases: ["booking no", "reservation no", "confirmation", "ref"] }),
      f("guestName", "Guest name", "অতিথির নাম", "text", "Karim Hossain", { required: true, max: 160, aliases: ["guest", "name"] }),
      f("phone", "Phone", "ফোন", "phone", "01911223344"),
      f("email", "Email", "ইমেইল", "email", ""),
      f("arrival", "Arrival", "আগমন", "date", "2026-11-12", { required: true, aliases: ["check in", "checkin", "from"] }),
      f("departure", "Departure", "প্রস্থান", "date", "2026-11-14", { required: true, aliases: ["check out", "checkout", "to"] }),
      f("roomTypeCode", "Room type code", "রুম টাইপ", "code", "DLX", { required: true }),
      f("roomNumber", "Room number (optional)", "রুম নম্বর", "code", ""),
      f("adults", "Adults", "প্রাপ্তবয়স্ক", "int", "2", { min: 1, max: 12 }),
      f("children", "Children", "শিশু", "int", "0", { min: 0, max: 12 }),
      f("ratePlanCode", "Rate plan code", "রেট প্ল্যান", "code", "BB"),
      f("nightlyRate", "Agreed nightly rate (blank = current rates)", "রাত্রিপ্রতি ভাড়া", "money", ""),
      f("source", "Source", "উৎস", "enum", "PHONE", { enum: SOURCES }),
      f("companyCode", "Company code", "প্রতিষ্ঠান কোড", "code", ""),
      f("deposit", "Deposit already received", "অগ্রিম", "money", "0.00"),
      f("depositMethod", "Deposit method code", "অগ্রিমের মাধ্যম", "code", "CASH"),
      f("notes", "Notes / special requests", "নোট", "text", "", { max: 2000 }),
    ],
  },
  {
    id: "openingBalances",
    label: "Opening balances (city ledger)",
    labelBn: "প্রারম্ভিক বকেয়া",
    description: "Amounts companies owe at go-live. Creates a city-ledger folio per row.",
    keyField: "reference",
    order: 10,
    createOnly: true,
    dependsOn: ["companies"],
    fields: [
      f("companyCode", "Company code", "প্রতিষ্ঠান কোড", "code", "GTL", { required: true }),
      f("reference", "Invoice / reference", "রেফারেন্স", "text", "OLD-INV-2291", { required: true, max: 60 }),
      f("amount", "Amount owed", "বকেয়া", "money", "45600.00", { required: true }),
      f("invoiceDate", "Invoice date", "চালানের তারিখ", "date", "2026-09-10", { required: true }),
      f("dueDate", "Due date", "পরিশোধের তারিখ", "date", "2026-10-10"),
    ],
  },
];

export const entityById = (id: string) => ENTITIES.find((e) => e.id === id);

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-./#()]+/g, "").trim();

/** Auto-maps file headers to fields using keys, labels (EN/BN) and aliases. Returns field key → header. */
export function autoMap(entity: EntityDef, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const fd of entity.fields) {
    const names = [fd.key, fd.label, fd.labelBn, ...(fd.aliases ?? [])].map(norm);
    const hit = headers.find((h) => !used.has(h) && names.includes(norm(h)));
    if (hit) {
      out[fd.key] = hit;
      used.add(hit);
    }
  }
  return out;
}

/** CSV template text for an entity (header + example row). */
export function templateCsv(entity: EntityDef): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return "﻿" + [entity.fields.map((x) => esc(x.key)).join(","), entity.fields.map((x) => esc(x.example)).join(",")].join("\r\n") + "\r\n";
}

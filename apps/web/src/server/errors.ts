// Errors that are safe to show to users. Anything else becomes a 500 with a reference id.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "VALIDATION", message, details);
export const unauthorized = (message = "Please sign in") => new ApiError(401, "UNAUTHENTICATED", message);
export const forbidden = (permission: string, message = "You do not have permission for this action") => new ApiError(403, "FORBIDDEN", message, { permission });
export const notFound = (what = "Record") => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message: string, details?: unknown) => new ApiError(409, "CONFLICT", message, details);
/** Optimistic-lock failure: details.current carries the latest version so the UI can show a conflict dialog. */
export const versionConflict = (entity: string, current: unknown) =>
  new ApiError(409, "VERSION_CONFLICT", `This ${entity} was changed by someone else while you were editing. Review the latest version.`, { current });
export const readOnly = (message: string) => new ApiError(423, "READ_ONLY", message);

/** Friendly bilingual messages for operating-system / network / database failures (technical detail goes to the log only). */
const SYS: Record<string, { status: number; code: string; en: string; bn: string }> = {
  ENOSPC: { status: 507, code: "DISK_FULL", en: "The disk is full. Free some space (delete old backups or exports) and try again.", bn: "ডিস্ক ভরে গেছে। জায়গা খালি করুন (পুরনো ব্যাকআপ বা এক্সপোর্ট মুছুন) এবং আবার চেষ্টা করুন।" },
  EDQUOT: { status: 507, code: "DISK_FULL", en: "The disk quota is exhausted. Free some space and try again.", bn: "ডিস্কের কোটা শেষ। জায়গা খালি করে আবার চেষ্টা করুন।" },
  EROFS: { status: 503, code: "STORAGE_READONLY", en: "The storage is read-only, so nothing can be saved. Check the drive or its permissions.", bn: "স্টোরেজ শুধু-পড়া অবস্থায় আছে, তাই কিছু সংরক্ষণ করা যাচ্ছে না। ড্রাইভ বা অনুমতি পরীক্ষা করুন।" },
  EACCES: { status: 503, code: "STORAGE_DENIED", en: "PetraPMS is not allowed to write to its data folder. Ask your administrator to check folder permissions.", bn: "PetraPMS তার ডেটা ফোল্ডারে লিখতে পারছে না। অ্যাডমিনকে ফোল্ডারের অনুমতি পরীক্ষা করতে বলুন।" },
  EPERM: { status: 503, code: "STORAGE_DENIED", en: "PetraPMS is not allowed to write to its data folder. Ask your administrator to check folder permissions.", bn: "PetraPMS তার ডেটা ফোল্ডারে লিখতে পারছে না। অ্যাডমিনকে ফোল্ডারের অনুমতি পরীক্ষা করতে বলুন।" },
  ENOTDIR: { status: 503, code: "STORAGE_UNAVAILABLE", en: "The chosen folder or drive is not available. Check that the drive is connected, or choose another folder.", bn: "নির্বাচিত ফোল্ডার বা ড্রাইভ পাওয়া যাচ্ছে না। ড্রাইভ লাগানো আছে কিনা দেখুন, অথবা অন্য ফোল্ডার বাছুন।" },
  ENOENT: { status: 503, code: "STORAGE_UNAVAILABLE", en: "The chosen folder or drive is not available. Check that the drive is connected, or choose another folder.", bn: "নির্বাচিত ফোল্ডার বা ড্রাইভ পাওয়া যাচ্ছে না। ড্রাইভ লাগানো আছে কিনা দেখুন, অথবা অন্য ফোল্ডার বাছুন।" },
  EEXIST: { status: 503, code: "STORAGE_UNAVAILABLE", en: "The chosen folder or drive is not available. Check that the drive is connected, or choose another folder.", bn: "নির্বাচিত ফোল্ডার বা ড্রাইভ পাওয়া যাচ্ছে না। ড্রাইভ লাগানো আছে কিনা দেখুন, অথবা অন্য ফোল্ডার বাছুন।" },
  EBUSY: { status: 503, code: "FILE_BUSY", en: "A file is in use by another program (antivirus or backup software?). Try again in a moment.", bn: "একটি ফাইল অন্য প্রোগ্রাম ব্যবহার করছে (অ্যান্টিভাইরাস বা ব্যাকআপ সফটওয়্যার?)। কিছুক্ষণ পর আবার চেষ্টা করুন।" },
  ECONNREFUSED: { status: 503, code: "DB_UNREACHABLE", en: "Cannot connect to the hotel database/server. Check that the server PC is on and the network is working.", bn: "হোটেল সার্ভার/ডেটাবেসের সাথে সংযোগ পাওয়া যাচ্ছে না। সার্ভার পিসি চালু আছে কিনা এবং নেটওয়ার্ক ঠিক আছে কিনা পরীক্ষা করুন।" },
  ENOTFOUND: { status: 503, code: "DB_UNREACHABLE", en: "Cannot find the hotel server on the network. Check the server address.", bn: "নেটওয়ার্কে হোটেল সার্ভার খুঁজে পাওয়া যাচ্ছে না। সার্ভারের ঠিকানা পরীক্ষা করুন।" },
  ETIMEDOUT: { status: 503, code: "DB_UNREACHABLE", en: "The hotel server did not answer in time. Check the network connection.", bn: "হোটেল সার্ভার সময়মতো সাড়া দেয়নি। নেটওয়ার্ক সংযোগ পরীক্ষা করুন।" },
  ECONNRESET: { status: 503, code: "DB_UNREACHABLE", en: "The connection to the hotel server was interrupted. Try again.", bn: "হোটেল সার্ভারের সংযোগ বিচ্ছিন্ন হয়েছে। আবার চেষ্টা করুন।" },
  SQLITE_BUSY: { status: 503, code: "DB_BUSY", en: "The database is busy. Please try again.", bn: "ডেটাবেস ব্যস্ত আছে। আবার চেষ্টা করুন।" },
  DAMAGED: { status: 503, code: "DB_DAMAGED", en: "The hotel database file is damaged. Stop working and restore the latest backup (Data center → Backup), or contact support.", bn: "হোটেলের ডেটাবেস ফাইল নষ্ট হয়েছে। কাজ বন্ধ করুন এবং সর্বশেষ ব্যাকআপ রিস্টোর করুন (ডেটা সেন্টার → ব্যাকআপ), অথবা সাপোর্টে যোগাযোগ করুন।" },
  CONFIG: { status: 503, code: "CONFIG_ERROR", en: "PetraPMS is not configured correctly. Contact your administrator (details are in the log).", bn: "PetraPMS ঠিকভাবে কনফিগার করা নেই। অ্যাডমিনের সাথে যোগাযোগ করুন (বিস্তারিত লগে আছে)।" },
};

/** Returns a user-friendly ApiError for known system failures, else null. The raw error must be logged by the caller. */
export function mapSystemError(e: unknown): ApiError | null {
  const err = e as { code?: string; name?: string; message?: string; cause?: { code?: string } } | null;
  if (!err) return null;
  let key: string | undefined;
  if (err.name === "DatabaseDamagedError") key = "DAMAGED";
  else if (err.name === "ConfigError") key = "CONFIG";
  else {
    const code = err.code ?? err.cause?.code;
    if (code && SYS[code]) key = code;
    else if (/database is locked|SQLITE_BUSY/i.test(err.message ?? "")) key = "SQLITE_BUSY";
    else if (/ECONNREFUSED|connect ECONN/i.test(err.message ?? "")) key = "ECONNREFUSED";
    // PostgreSQL restarted / network dropped / server unreachable (pg and Prisma wording and codes)
    else if (/Connection terminated|terminating connection|server closed the connection|Can't reach database server|Connection (?:ended|closed)|timeout exceeded when trying to connect/i.test(err.message ?? "") || ["57P01", "57P02", "57P03", "08000", "08003", "08006", "08001", "08004", "P1001", "P1002", "P1008", "P1017"].includes(String(code))) key = "ECONNRESET";
    else if (/ENOSPC|no space left/i.test(err.message ?? "")) key = "ENOSPC";
    else if (/EROFS|read-only file system|readonly database/i.test(err.message ?? "")) key = "EROFS";
  }
  if (!key) return null;
  const m = SYS[key];
  return new ApiError(m.status, m.code, m.en, { bn: m.bn });
}

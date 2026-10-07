// pnpm db:seed — create a demo hotel on a running server (default http://127.0.0.1:3000).
// Admin: admin / Admin1234 (change it!). Only for a fresh database.
const base = (process.env.PETRA_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const body = {
  locale: "en",
  hotel: { name: "Demo Hotel", address: "Gulshan 2", city: "Dhaka", phone: "01711000000", email: "demo@example.com", bin: "000123456789", checkInTime: "14:00", checkOutTime: "12:00" },
  floors: [{ floor: "1", firstNumber: 101, count: 10 }, { floor: "2", firstNumber: 201, count: 10 }, { floor: "3", firstNumber: 301, count: 10 }],
  roomTypes: [
    { code: "STD", name: "Standard", bedType: "DOUBLE", baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, baseRate: 400000, extraBedRate: 80000 },
    { code: "DLX", name: "Deluxe", bedType: "KING", baseOccupancy: 2, maxAdults: 3, maxChildren: 2, maxOccupancy: 4, baseRate: 650000, extraBedRate: 100000 },
  ],
  assignments: [{ roomTypeCode: "DLX", from: "201", to: "310" }],
  tax: { vatBp: 1500, scBp: 1000, mode: "EXCLUSIVE" },
  admin: { fullName: "Administrator", username: "admin", password: "Admin1234", pin: "7392" },
  loadDemo: true,
};
const r = await fetch(base + "/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const j = await r.json();
if (!j.ok) { console.error("Seed failed:", j.error?.message); process.exit(1); }
console.log("Demo hotel created. Sign in with admin / Admin1234");

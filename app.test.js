// app.test.js
const request = require("supertest"); // ดึง Supertest มาใช้สำหรับส่ง HTTP Request จำลอง (GET, POST, DELETE) เข้า App

// ==========================================
// 1. MOCKING ZONE (จำลองการทำงานของไฟล์ภายนอก)
// ==========================================

// จำลองการทำงานของ Redis เพื่อไม่ให้ Test ต้องต่อ Redis Database จริงๆ
jest.mock("./cache", () => ({
  redisClient: {
    get: jest.fn().mockResolvedValue(null), // เมื่อเรียก get ให้ส่งค่า null กลับมา
    set: jest.fn().mockResolvedValue("OK"), // เมื่อเรียก set ให้คืนค่า "OK"
    del: jest.fn().mockResolvedValue(1), // เมื่อสั่งลบแคช (del) ให้คืนค่า 1 (สำเร็จ)
    on: jest.fn(), // จำลอง Event Listener
    connect: jest.fn().mockResolvedValue(), // จำลองการเชื่อมต่อ Redis
  },
  connectRedis: jest.fn().mockResolvedValue(),
}));

// จำลองการทำงานของ Database (MySQL Pool) จะได้ไม่ต้องต่อฐานข้อมูลจริง
jest.mock("./db");

const app = require("./app"); // ดึง Express app ที่ต้องการทดสอบเข้ามา
const pool = require("./db"); // ดึง mock pool เข้ามาเพื่อกำหนดค่า Return ในแต่ละ Test Case

// ==========================================
// 2. MAIN TEST SUITE (กลุ่มเคสการทดสอบหลัก)
// ==========================================
describe("App.js Integration Tests", () => {
  // ทำงานก่อนเริ่มรัน "ทุกๆ test case" ในบล็อกนี้
  beforeEach(() => {
    jest.clearAllMocks(); // ล้างประวัติการเรียกใช้ Mock ทั้งหมด เพื่อไม่ให้ผลการทดสอบปนกัน
    process.env.JWT_SECRET = "test_secret"; // ตั้งค่า Secret Key จำลองใน Environment Variable
  });

  // ทดสอบ Route พื้นฐาน หน้า Home
  test("GET / ควรคืนสถานะ 200", async () => {
    const res = await request(app).get("/"); // ยิง GET ไปที่ /
    expect(res.status).toBe(200); // คาดหวังว่า Status Code ต้องเป็น 200
  });

  // ------------------------------------------
  // กลุ่มทดสอบ: GET /api/v1/students
  // ------------------------------------------
  describe("GET /api/v1/students", () => {
    test("ควรคืน 200 พร้อมข้อมูลเมื่อระบุ major", async () => {
      // กำหนดค่าจำลองการ Query DB 2 ครั้งตามที่แอปเรียกจริง:
      // ครั้งที่ 1: คืนข้อมูลรายการนักศึกษา
      // ครั้งที่ 2: คืนจำนวนทั้งหมด (total) สำหรับทำ Pagination
      pool.query
        .mockResolvedValueOnce([[{ id: 1, major: "CS" }]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app).get("/api/v1/students?major=CS"); // ยิง GET พร้อม Query Param
      expect(res.status).toBe(200); // ต้องได้ 200 OK
    });
  });

  // ------------------------------------------
  // กลุ่มทดสอบ: GET /api/v1/students/:id
  // ------------------------------------------
  describe("GET /api/v1/students/:id", () => {
    test("ควรคืน 404 เมื่อไม่พบข้อมูลนิสิต", async () => {
      pool.query.mockResolvedValueOnce([[]]); // คืนอาร์เรย์ว่าง (ค้นหาแล้วไม่เจอข้อมูลใน DB)

      const res = await request(app).get("/api/v1/students/999");
      expect(res.status).toBe(404); // ต้องตอบกลับว่า ไม่พบข้อมูล (404)
    });

    test("ควรคืน 200 เมื่อพบข้อมูลนิสิต", async () => {
      pool.query.mockResolvedValueOnce([[{ id: 1, name: "John" }]]); // พบข้อมูลนักศึกษา 1 คน

      const res = await request(app).get("/api/v1/students/1");
      expect(res.status).toBe(200); // ต้องตอบกลับว่า สำเร็จ (200)
    });
  });

  // ------------------------------------------
  // กลุ่มทดสอบ: POST /api/v1/students (สร้างนิสิตใหม่)
  // ------------------------------------------
  describe("POST /api/v1/students", () => {
    test("ควรคืน 400 เมื่อข้อมูลไม่ครบ", async () => {
      // ยิง POST ส่งเฉพาะ name (ขาด major และ email ที่จำเป็น)
      const res = await request(app)
        .post("/api/v1/students")
        .send({ name: "John" });

      expect(res.status).toBe(400); // Validation Failed ต้องตอบกลับ 400 Bad Request
    });

    test("ควรคืน 201 เมื่อเพิ่มนิสิตสำเร็จ", async () => {
      // จำลองว่า DB ทำการ INSERT สำเร็จ และคืนค่า insertId มาเป็น 10
      pool.query.mockResolvedValueOnce([{ insertId: 10 }, undefined]);

      const res = await request(app)
        .post("/api/v1/students")
        .send({ name: "John", major: "CS", email: "john@test.com" });

      expect(res.status).toBe(201); // สร้างข้อมูลสำเร็จ ต้องตอบกลับ 201 Created
    });

    test("ควรคืน 409 เมื่ออีเมลซ้ำ", async () => {
      // สร้าง Error จำลองของ MySQL เมื่อข้อมูลอีเมลซ้ำ (ER_DUP_ENTRY)
      const dbError = new Error("Duplicate entry");
      dbError.code = "ER_DUP_ENTRY";
      pool.query.mockRejectedValueOnce(dbError); // สั่งให้ pool.query พังด้วย Error นี้

      const res = await request(app)
        .post("/api/v1/students")
        .send({ name: "John", major: "CS", email: "dup@test.com" });

      expect(res.status).toBe(409); // ข้อมูลขัดแย้ง/ซ้ำซ้อน ต้องตอบกลับ 409 Conflict
    });
  });

  // ------------------------------------------
  // กลุ่มทดสอบ: POST /api/v1/students/:id/enrollments (ลงทะเบียนเรียน)
  // ------------------------------------------
  describe("POST /api/v1/students/:id/enrollments", () => {
    let mockConn;

    // สร้าง Mock Connection สำหรับ Database Transaction (Begin / Commit / Rollback)
    beforeEach(() => {
      mockConn = {
        beginTransaction: jest.fn().mockResolvedValue(),
        query: jest.fn(),
        commit: jest.fn().mockResolvedValue(),
        rollback: jest.fn().mockResolvedValue(),
        release: jest.fn(),
      };
      // เมื่อแอปเรียก pool.getConnection() ให้ส่ง object Connection จำลองนี้ไปให้ใช้
      pool.getConnection.mockResolvedValue(mockConn);
    });

    test("ควรคืน 400 เมื่อไม่ระบุ courseId", async () => {
      const res = await request(app)
        .post("/api/v1/students/1/enrollments")
        .send({}); // ส่ง body ว่างเปล่า

      expect(res.status).toBe(400); // Validation Failed ตอบกลับ 400
    });

    test("ควรคืน 404 เมื่อไม่พบวิชาเรียน", async () => {
      mockConn.query.mockResolvedValueOnce([[]]); // จำลองว่าค้นหาวิชาเรียนแล้วไม่พบใน DB

      const res = await request(app)
        .post("/api/v1/students/1/enrollments")
        .send({ courseId: 999 });

      expect(res.status).toBe(404); // ไม่พบรายวิชา ตอบกลับ 404
    });

    test("ควรคืน 409 เมื่อที่นั่งเต็ม", async () => {
      // จำลองค้นเจอวิชา แต่ที่นั่งเหลือ 0 (seat_available: 0)
      mockConn.query.mockResolvedValueOnce([[{ id: 1, seat_available: 0 }]]);

      const res = await request(app)
        .post("/api/v1/students/1/enrollments")
        .send({ courseId: 1 });

      expect(res.status).toBe(409); // ที่นั่งเต็ม ตอบกลับ 409 Conflict
    });

    test("ควรคืน 409 เมื่อลงทะเบียนซ้ำ", async () => {
      // 1. Query ครั้งแรก: ค้นหาวิชาแล้วเจอว่ายังมีที่นั่งว่าง (seat_available: 10)
      mockConn.query.mockResolvedValueOnce([[{ id: 1, seat_available: 10 }]]);

      // 2. Query ครั้งที่สอง (ตอนยิง INSERT ลงทะเบียน): จำลองว่าติด Error ข้อมูลซ้ำ
      const dbError = new Error("Duplicate entry");
      dbError.code = "ER_DUP_ENTRY";
      mockConn.query.mockRejectedValueOnce(dbError);

      const res = await request(app)
        .post("/api/v1/students/1/enrollments")
        .send({ courseId: 1 });

      expect(res.status).toBe(409); // เคยลงทะเบียนวิชานี้ไปแล้ว ตอบกลับ 409 Conflict
    });
  });
});

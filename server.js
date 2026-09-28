// server.js
require("dotenv").config();
const app = require("./app");
const { connectRedis } = require("./cache");
const PORT = process.env.PORT || 3000;

connectRedis()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`เซิร์ฟเวอร์ทำงานที่พอร์ต ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("เชื่อมต่อ Redis ไม่สำเร็จ เซิร์ฟเวอร์จะไม่เริ่มทำงาน:", err);
    process.exit(1);
  });

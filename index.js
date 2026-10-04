require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const contactRoutes = require("./routes/contactRoutes");

const app = express();

const PORT = Number(process.env.PORT) || 4000;

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  process.env.FRONTEND_URL?.trim(),
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
  })
);

app.use(express.json({ limit: "20kb" }));

// Request logging for the contact endpoint.
// This lets us confirm that the browser is actually reaching this backend.
app.use((req, _res, next) => {
  if (req.method === "POST" && req.path === "/api/contact") {
    console.log("[CONTACT] Incoming request:", {
      origin: req.headers.origin || "none",
      userAgent: req.headers["user-agent"] || "unknown",
    });
  }

  next();
});

app.get("/", (req, res) => {
  res.json({
    message: "Portfolio backend is running successfully",
  });
});

app.get("/api/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;

  res.status(connected ? 200 : 503).json({
    success: connected,
    database: connected ? "connected" : "disconnected",
  });
});

app.use("/api/contact", contactRoutes);

// JSON response for CORS errors and other Express errors.
app.use((error, _req, res, _next) => {
  console.error("[SERVER] Express error:", error?.message || error);

  if (error?.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      saved: false,
      emailSent: false,
      stage: "cors",
      message: "This frontend origin is not allowed by the backend.",
    });
  }

  return res.status(500).json({
    success: false,
    saved: false,
    emailSent: false,
    stage: "server",
    message: "Internal server error.",
  });
});

async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing in .env");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    console.log("MongoDB connected successfully");

   app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
  } catch (error) {
    console.error(
      "Server startup failed:",
      error instanceof Error ? error.message : error
    );

    process.exit(1);
  }
}

startServer();
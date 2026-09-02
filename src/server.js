require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { initCronJobs } = require('./utils/cronJobs');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable 'trust proxy' for Vercel/Render reverse proxies
app.set('trust proxy', 1);

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 200, // Limit each IP to 200 requests per `window` (here, per 15 minutes).
  standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
  validate: { xForwardedForHeader: false },
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later.' } }
});

// Initialize Cron Jobs
initCronJobs();

// Global Middlewares
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://cloud-based-media-files-storage-fro.vercel.app',
  'https://cloud-based-media-files-storage-frontend.ayanmanna858.workers.dev',
  'https://cloud-box-cloud-storage.vercel.app',
  'https://cloudbox-cloud-storage.ayanmanna858.workers.dev'

];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL.replace(/\/$/, ''));
}
if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL.replace(/\/$/, ''));
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.replace(/\/$/, '');
    const isAllowed = 
      allowedOrigins.indexOf(cleanOrigin) !== -1 ||
      cleanOrigin.endsWith('.vercel.app') ||
      cleanOrigin.endsWith('.workers.dev');

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
})); // Enable credentials for cookies

app.use(helmet({
  crossOriginOpenerPolicy: false,
}));
app.use(limiter); // Apply rate limiting to all requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API Request Logger Middleware
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const statusSymbol = statusCode >= 400 ? '❌' : '✅';
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[API CALL] [${timestamp}] ${statusSymbol} Method: ${method} | Endpoint: ${originalUrl} | Status: ${statusCode} | Time: ${duration}ms`);
  });

  next();
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// API Routes
app.use('/api', routes);

// Global Error Handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'Something went wrong';

  console.error(`[BACKEND ERROR] 🚨 ${req.method} ${req.originalUrl} | Status: ${statusCode} (${code}) | Error: ${message}`);
  if (err.stack) {
    console.error(`Stack trace:\n${err.stack}`);
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
    },
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

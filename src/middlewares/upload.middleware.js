const multer = require('multer');
const path = require('path');
const fs = require('fs');

const os = require('os');

// Determine writeable uploads directory (use os.tmpdir() on Vercel / serverless environment)
let uploadDir = path.join(__dirname, '../../uploads');
if (process.env.VERCEL) {
  uploadDir = path.join(os.tmpdir(), 'uploads');
}

try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.warn('[Upload Middleware] Could not create upload directory, falling back to OS temp dir:', err.message);
  uploadDir = os.tmpdir();
}

// Multer Disk Storage Engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `meal-${uniqueSuffix}${ext}`);
  }
});

// File Filter (Images Only)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, WEBP) are allowed!'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter
});

module.exports = upload;

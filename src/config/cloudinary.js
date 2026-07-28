const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'tnvepxjn',
  api_key: process.env.CLOUDINARY_API_KEY || '935365788832361',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'tqg6RPvCiCa_LXjuirkX-4Vw4fU',
});

module.exports = cloudinary;

const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { adminOnly } = require('../middleware/auth');

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Solo se permiten imágenes JPG, PNG, WEBP o GIF'));
  },
});

const uploadVideo = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.webm', '.mov', '.ogg'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Solo se permiten videos MP4, WEBM, MOV u OGG'));
  },
});

// Envuelve un middleware de multer para devolver errores como JSON legible
function run(mw) {
  return (req, res, next) => mw(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Error al subir el archivo' });
    next();
  });
}

// POST /api/upload  -> hasta 6 imagenes (admin only)
router.post('/', adminOnly, run(upload.array('images', 6)), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No se recibieron archivos' });
  const urls = req.files.map(f => '/uploads/' + f.filename);
  res.json({ urls });
});

// POST /api/upload/video  -> 1 video (admin only)
router.post('/video', adminOnly, run(uploadVideo.single('video')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún video' });
  res.json({ url: '/uploads/' + req.file.filename });
});

module.exports = router;

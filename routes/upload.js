const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { adminOnly } = require('../middleware/auth');

const uploadsDir = path.join(__dirname, '..', 'uploads');
// En Vercel el disco es de solo lectura: crear la carpeta fallaria y tumbaria la API entera.
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch (_) {}

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

// POST /api/upload  -> hasta 12 imagenes (admin only)
router.post('/', adminOnly, run(upload.array('images', 12)), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No se recibieron archivos' });
  const urls = req.files.map(f => '/uploads/' + f.filename);
  res.json({ urls });
});

/* ¿El video trae pista de audio?
   En MP4/MOV cada pista se declara en una caja "hdlr" cuyo handler_type dice de
   qué es: 'vide' para imagen, 'soun' para sonido. Si no hay ninguna 'soun', el
   archivo viene mudo de origen y por mucho que el reproductor esté bien nunca
   se va a oír; así que avisamos al subirlo en vez de descubrirlo publicado.
   Devuelve null (= no sabemos) para formatos que no usan estas cajas. */
function videoTieneAudio(rutaArchivo) {
  const ext = path.extname(rutaArchivo).toLowerCase();
  if (ext !== '.mp4' && ext !== '.mov') return null; // WEBM/OGG no usan 'hdlr'
  try {
    const buf = fs.readFileSync(rutaArchivo);
    let i = buf.indexOf('hdlr', 0, 'latin1');
    while (i !== -1) {
      // hdlr = [size 4][ 'hdlr' 4][version+flags 4][pre_defined 4][handler_type 4]
      if (buf.toString('latin1', i + 12, i + 16) === 'soun') return true;
      i = buf.indexOf('hdlr', i + 4, 'latin1');
    }
    return false;
  } catch {
    return null;
  }
}

// POST /api/upload/video  -> 1 video (admin only)
router.post('/video', adminOnly, run(uploadVideo.single('video')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún video' });
  res.json({
    url: '/uploads/' + req.file.filename,
    hasAudio: videoTieneAudio(req.file.path), // true | false | null (desconocido)
  });
});

module.exports = router;

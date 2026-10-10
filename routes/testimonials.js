const router = require('express').Router();
const pool   = require('../db/connection');
const { adminOnly } = require('../middleware/auth');

function parse(t) {
  return { id: t.id, imageUrl: t.image_url, caption: t.caption, sortOrder: t.sort_order, active: !!t.active, createdAt: t.created_at };
}

// GET /api/testimonials  -> publicas (solo activas, ordenadas)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM testimonials WHERE active = 1 ORDER BY sort_order ASC, id ASC'
    );
    res.json(rows.map(parse));
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al obtener testimonios' });
  }
});

// GET /api/testimonials/admin  -> todas (para el panel)
router.get('/admin', adminOnly, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM testimonials ORDER BY sort_order ASC, id ASC');
  res.json(rows.map(parse));
});

// POST /api/testimonials  { imageUrl, caption? }  (admin)
router.post('/', adminOnly, async (req, res) => {
  try {
    const imageUrl = String(req.body.imageUrl || '').trim();
    const caption  = req.body.caption ? String(req.body.caption).slice(0, 255) : null;
    if (!imageUrl) return res.status(400).json({ error: 'Falta la imagen' });

    const [[{ next }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM testimonials');
    const [result] = await pool.execute(
      'INSERT INTO testimonials (image_url, caption, sort_order) VALUES (?, ?, ?)',
      [imageUrl, caption, next]
    );
    res.status(201).json({ id: result.insertId, ok: true });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al guardar testimonio' });
  }
});

// PUT /api/testimonials/:id  { active?, caption?, sortOrder? }  (admin)
router.put('/:id', adminOnly, async (req, res) => {
  const { active, caption, sortOrder } = req.body;
  const fields = []; const params = [];
  if (active !== undefined)    { fields.push('active = ?');     params.push(active ? 1 : 0); }
  if (caption !== undefined)   { fields.push('caption = ?');    params.push(caption ? String(caption).slice(0, 255) : null); }
  if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(Number(sortOrder) || 0); }
  if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
  params.push(req.params.id);
  await pool.execute(`UPDATE testimonials SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

// DELETE /api/testimonials/:id  (admin)
router.delete('/:id', adminOnly, async (req, res) => {
  await pool.execute('DELETE FROM testimonials WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;

const router = require('express').Router();
const pool   = require('../db/connection');
const { adminOnly } = require('../middleware/auth');

function parseCat(row) {
  return { key: row.key, label: row.label, icon: row.icon, active: !!row.active };
}

// GET /api/categories  → { key: { label, icon, active } }
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM categories ORDER BY sort_order ASC, id ASC');
    const cats = {};
    rows.forEach(r => { cats[r.key] = { label: r.label, icon: r.icon, active: !!r.active }; });
    res.json(cats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// POST /api/categories
router.post('/', adminOnly, async (req, res) => {
  try {
    const { label, icon, active } = req.body;
    if (!label) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const key = label.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const [exists] = await pool.execute('SELECT id FROM categories WHERE `key` = ?', [key]);
    if (exists.length) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });

    const [maxOrder] = await pool.execute('SELECT MAX(sort_order) as m FROM categories');
    const nextOrder = (maxOrder[0].m || 0) + 1;

    await pool.execute(
      'INSERT INTO categories (`key`, label, icon, active, sort_order) VALUES (?, ?, ?, ?, ?)',
      [key, label.trim(), icon || 'fa-solid fa-tag', active !== false ? 1 : 0, nextOrder]
    );
    res.status(201).json({ key, label: label.trim(), icon: icon || 'fa-solid fa-tag', active: active !== false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

// PUT /api/categories/:key
router.put('/:key', adminOnly, async (req, res) => {
  try {
    const { label, icon, active } = req.body;
    const [exists] = await pool.execute('SELECT id FROM categories WHERE `key` = ?', [req.params.key]);
    if (!exists.length) return res.status(404).json({ error: 'Categoría no encontrada' });

    await pool.execute(
      'UPDATE categories SET label=?, icon=?, active=? WHERE `key`=?',
      [label, icon || 'fa-solid fa-tag', active !== false ? 1 : 0, req.params.key]
    );
    res.json({ key: req.params.key, label, icon, active: active !== false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar categoría' });
  }
});

// DELETE /api/categories/:key
router.delete('/:key', adminOnly, async (req, res) => {
  try {
    const [inUse] = await pool.execute('SELECT id FROM products WHERE category = ? LIMIT 1', [req.params.key]);
    if (inUse.length) return res.status(409).json({ error: 'Categoría en uso por uno o más productos' });

    await pool.execute('DELETE FROM categories WHERE `key` = ?', [req.params.key]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

module.exports = router;

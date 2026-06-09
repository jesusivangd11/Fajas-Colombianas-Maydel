const router = require('express').Router();
const pool   = require('../db/connection');
const { adminOnly } = require('../middleware/auth');

// GET /api/brands  → { key: { label, logo, icon, active } }
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM brands ORDER BY sort_order ASC, id ASC');
    const brands = {};
    rows.forEach(r => { brands[r.key] = { label: r.label, logo: r.logo || '', icon: r.icon, active: !!r.active }; });
    res.json(brands);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener marcas' });
  }
});

// POST /api/brands
router.post('/', adminOnly, async (req, res) => {
  try {
    const { label, logo, icon, active } = req.body;
    if (!label) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const key = label.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!key) return res.status(400).json({ error: 'Nombre de marca inválido' });

    const [exists] = await pool.execute('SELECT id FROM brands WHERE `key` = ?', [key]);
    if (exists.length) return res.status(409).json({ error: 'Ya existe una marca con ese nombre' });

    const [maxOrder] = await pool.execute('SELECT MAX(sort_order) as m FROM brands');
    const nextOrder = (maxOrder[0].m || 0) + 1;

    await pool.execute(
      'INSERT INTO brands (`key`, label, logo, icon, active, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [key, label.trim(), logo || null, icon || 'fa-solid fa-certificate', active !== false ? 1 : 0, nextOrder]
    );
    res.status(201).json({ key, label: label.trim(), logo: logo || '', icon: icon || 'fa-solid fa-certificate', active: active !== false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear marca' });
  }
});

// PUT /api/brands/:key
router.put('/:key', adminOnly, async (req, res) => {
  try {
    const { label, logo, icon, active } = req.body;
    const [exists] = await pool.execute('SELECT id FROM brands WHERE `key` = ?', [req.params.key]);
    if (!exists.length) return res.status(404).json({ error: 'Marca no encontrada' });

    await pool.execute(
      'UPDATE brands SET label=?, logo=?, icon=?, active=? WHERE `key`=?',
      [label, logo || null, icon || 'fa-solid fa-certificate', active !== false ? 1 : 0, req.params.key]
    );
    res.json({ key: req.params.key, label, logo: logo || '', icon, active: active !== false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar marca' });
  }
});

// DELETE /api/brands/:key
router.delete('/:key', adminOnly, async (req, res) => {
  try {
    const [inUse] = await pool.execute('SELECT id FROM products WHERE brand = ? LIMIT 1', [req.params.key]);
    if (inUse.length) return res.status(409).json({ error: 'Marca en uso por uno o más productos' });

    await pool.execute('DELETE FROM brands WHERE `key` = ?', [req.params.key]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar marca' });
  }
});

module.exports = router;

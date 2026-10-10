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
// En vez de bloquear si hay productos usándola, la RETIRA de cada producto (del
// arreglo `categories` y, si era la principal, reasigna a la siguiente) y luego
// borra la categoría. Devuelve cuántos productos quedaron afectados.
router.delete('/:key', adminOnly, async (req, res) => {
  const key = req.params.key;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[cat]] = await conn.execute('SELECT id FROM categories WHERE `key` = ?', [key]);
    if (!cat) { await conn.rollback(); return res.status(404).json({ error: 'Categoría no encontrada' }); }

    // Productos que la tienen (en el arreglo o como principal).
    const [prods] = await conn.execute(
      'SELECT id, category, categories FROM products WHERE JSON_CONTAINS(categories, ?) OR category = ? FOR UPDATE',
      [JSON.stringify(key), key]
    );
    for (const p of prods) {
      const list = Array.isArray(p.categories) ? p.categories : (p.category ? [p.category] : []);
      const next = list.filter(c => c !== key);
      const primary = next[0] || '';   // la nueva principal es la primera que quede
      await conn.execute('UPDATE products SET categories = ?, category = ? WHERE id = ?', [JSON.stringify(next), primary, p.id]);
    }

    await conn.execute('DELETE FROM categories WHERE `key` = ?', [key]);
    await conn.commit();
    res.json({ ok: true, affected: prods.length });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar categoría' });
  } finally {
    conn.release();
  }
});

module.exports = router;
